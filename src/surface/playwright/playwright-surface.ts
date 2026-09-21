import { randomUUID } from 'node:crypto';
import type { Dialog, ElementHandle, Page } from 'playwright';

import type {
  ActionExecutionRequest,
  ConditionEvaluationRequest,
  ConditionTarget,
  EvidenceCaptureRequest,
  EvidenceCaptureResult,
  ObservationOptions,
  ObservationResult,
  SurfaceAdapter,
  SurfaceOperationOptions,
  TargetResolutionRequest,
  TargetResolutionResult,
} from '../adapter.js';

import type {
  ActionResult,
  ConditionResult,
  ConditionWaitOptions,
  JsonValue,
  NativeDialogObservation,
  ResolvedTarget,
  SurfaceCondition,
  SurfaceFailure,
  SurfaceScope,
} from '../index.js';

import { collect } from './collect.js';

import { resolvePlaywrightStrategy } from './resolve-strategy.js';

import type { PlaywrightStrategy } from './resolve-strategy.js';

export type { PlaywrightStrategy } from './resolve-strategy.js';

import { isUninitializedPlaywrightDocument } from './initial-document.js';

class Fault extends Error {
  constructor(
    readonly code: SurfaceFailure['code'],
    message: string,
  ) {
    super(message);
  }
}

const failure = (error: unknown): SurfaceFailure => ({
  code: error instanceof Fault ? error.code : 'ACTION_FAILED',

  // Raw Playwright errors can contain typed values and selectors.
  message: error instanceof Fault ? error.message : 'Browser operation failed',

  expected: null,
  observed: null,
});

const positive = (value: number): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Fault('ACTION_FAILED', 'Budget must be positive and finite');
  }
};

export class PlaywrightSurface implements SurfaceAdapter<PlaywrightStrategy> {
  readonly scope: SurfaceScope;

  private observationId = '';
  private revision = 0;

  private handles = new Map<
    string,
    {
      target: ResolvedTarget;
      element: ElementHandle<HTMLElement | SVGElement>;
    }
  >();

  private pending = new Map<
    string,
    {
      dialog: Dialog;
      observation: NativeDialogObservation;
    }
  >();

  private busy = false;
  private poisoned = false;

  private readonly onNavigation = () => this.invalidate();

  private readonly onDialog = (dialog: Dialog) => {
    const dialogId = randomUUID();

    this.pending.set(dialogId, {
      dialog,
      observation: {
        kind: 'native',
        dialogId,
        type: dialog.type() as NativeDialogObservation['type'],
        message: dialog.message(),
        defaultValue: dialog.type() === 'prompt' ? dialog.defaultValue() : null,
      },
    });
  };

  constructor(
    private readonly page: Page,
    scope: SurfaceScope,
  ) {
    this.scope = Object.freeze({ ...scope });

    page.on('framenavigated', this.onNavigation);
    page.on('dialog', this.onDialog);
  }

  /**
   * Session owner closes the page before disposing the adapter.
   */
  dispose(): void {
    if (!this.page.isClosed()) {
      throw new Error('Close the page before disposing its surface');
    }

    this.page.off('framenavigated', this.onNavigation);
    this.page.off('dialog', this.onDialog);

    this.invalidate();
    this.pending.clear();
  }

  private invalidate(): void {
    this.observationId = '';
    this.revision++;

    for (const { element } of this.handles.values()) {
      void element.dispose().catch(() => undefined);
    }

    this.handles.clear();
  }

  /**
   * Mutating operations poison the surface if interrupted.
   * Read-only observations and condition checks only expire.
   */
  private async bounded<T>(
    options: SurfaceOperationOptions,
    work: () => Promise<T>,
    mutating = false,
  ): Promise<T> {
    positive(options.timeoutMs);

    if (options.signal?.aborted) {
      throw new Fault('SURFACE_UNAVAILABLE', 'Operation cancelled');
    }

    if (this.poisoned || this.page.isClosed()) {
      throw new Fault('SURFACE_UNAVAILABLE', 'Surface unavailable');
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    let cancel = () => {};

    const stopped = new Promise<never>((_, reject) => {
      const interrupt = (timedOut: boolean) => {
        this.invalidate();

        if (mutating) {
          this.poisoned = true;

          void this.page
            .close({
              runBeforeUnload: false,
            })
            .catch(() => undefined);
        }

        reject(
          new Fault(
            timedOut && !mutating ? 'CONDITION_TIMEOUT' : 'SURFACE_UNAVAILABLE',
            timedOut
              ? mutating
                ? 'Operation timed out; page invalidated'
                : 'Read-only operation timed out'
              : mutating
                ? 'Operation cancelled; page invalidated'
                : 'Read-only operation cancelled',
          ),
        );
      };

      cancel = () => interrupt(false);

      timer = setTimeout(() => interrupt(true), options.timeoutMs);

      options.signal?.addEventListener('abort', cancel, {
        once: true,
      });
    });

    try {
      return await Promise.race([work(), stopped]);
    } finally {
      clearTimeout(timer);

      options.signal?.removeEventListener('abort', cancel);
    }
  }

  async observe(options: ObservationOptions): Promise<ObservationResult> {
    try {
      return await this.bounded(options, async () => {
        positive(options.maxTextLength);
        positive(options.maxControls);

        if (!Number.isInteger(options.maxTextLength) || !Number.isInteger(options.maxControls)) {
          throw new Fault('ACTION_FAILED', 'Observation limits must be integers');
        }

        if (this.busy) {
          throw new Fault('SURFACE_UNAVAILABLE', 'An action is in progress');
        }

        this.invalidate();

        const observationId = randomUUID();
        const revision = this.revision;
        const currentUrl = this.page.url();

        const uninitializedDocument =
          this.pending.size === 0 &&
          currentUrl === 'about:blank' &&
          isUninitializedPlaywrightDocument(currentUrl, await this.page.content());

        const rendererUnavailable = this.pending.size > 0 || uninitializedDocument;

        /*
         * Native dialogs block renderer calls.
         * A new about:blank page also has no application
         * document worth projecting before entry navigation.
         */
        const data = rendererUnavailable
          ? {
              visibleText: '',
              controls: [],
              dialogs: [],
              loading: 'unknown' as const,
              truncated: {
                visibleText: this.pending.size > 0,
                controls: this.pending.size > 0,
              },
            }
          : await this.page.evaluate(collect, {
              maxTextLength: options.maxTextLength,
              maxControls: options.maxControls,
            });

        const title = rendererUnavailable ? '' : await this.page.title();

        if (revision !== this.revision) {
          throw new Fault('STALE_TARGET', 'Page changed during observation');
        }

        this.observationId = observationId;

        return {
          status: 'success',
          observation: {
            ...this.scope,
            observationId,
            capturedAt: new Date().toISOString(),
            location: {
              kind: 'web',
              url: this.page.url(),
              title,
            },
            ...data,
            dialogs: [
              ...data.dialogs,
              ...[...this.pending.values()].map((entry) => entry.observation),
            ],
          },
        };
      });
    } catch (error) {
      return {
        status: 'failure',
        error: failure(error),
      };
    }
  }

  private current(id: string): void {
    if (!id || id !== this.observationId) {
      throw new Fault('STALE_TARGET', 'Observation is stale');
    }
  }

  async resolveTarget(
    request: TargetResolutionRequest<PlaywrightStrategy>,
    options: SurfaceOperationOptions,
  ): Promise<TargetResolutionResult> {
    try {
      return await this.bounded(options, async () => {
        this.current(request.observationId);

        if (this.pending.size || this.busy) {
          throw new Fault('SURFACE_UNAVAILABLE', 'Surface is blocked');
        }

        const elements = await resolvePlaywrightStrategy(this.page, request.strategy);

        const count = elements.length;

        if (!count) {
          return {
            status: 'not_found',
            matchCount: 0,
          };
        }

        if (count !== 1) {
          await Promise.all(elements.map((element) => element.dispose()));

          return {
            status: 'ambiguous',
            matchCount: count,
          };
        }

        const element = elements[0];

        if (!element) {
          return {
            status: 'not_found',
            matchCount: 0,
          };
        }

        this.current(request.observationId);

        const target: ResolvedTarget = {
          ...this.scope,
          resolutionId: randomUUID(),
          observationId: request.observationId,
          resolvedAt: new Date().toISOString(),
          description: request.description,
          matchedStrategyIndex: request.strategyIndex,
          cardinality: 'exactly-one',
        };

        this.handles.set(target.resolutionId, {
          target,
          element,
        });

        return {
          status: 'resolved',
          target,
        };
      });
    } catch (error) {
      return {
        status: 'failure',
        error: failure(error),
      };
    }
  }

  private async element(target: ResolvedTarget) {
    this.current(target.observationId);

    const entry = this.handles.get(target.resolutionId);

    if (
      !entry ||
      entry.target !== target ||
      target.sessionId !== this.scope.sessionId ||
      target.surfaceId !== this.scope.surfaceId ||
      !(await entry.element.evaluate((el) => el.isConnected))
    ) {
      throw new Fault('STALE_TARGET', 'Resolved handle is stale or foreign');
    }

    return entry.element;
  }

  private async interruptOnDialog<T>(work: () => Promise<T>): Promise<T> {
    let listener: (dialog: Dialog) => void = () => {};

    const interrupted = new Promise<never>((_, reject) => {
      listener = () =>
        reject(
          new Fault(
            'ACTION_FAILED',
            'Action opened a native dialog; observe and handle it explicitly',
          ),
        );

      this.page.on('dialog', listener);
    });

    try {
      return await Promise.race([work(), interrupted]);
    } finally {
      this.page.off('dialog', listener);
    }
  }

  async perform(
    request: ActionExecutionRequest,
    options: SurfaceOperationOptions,
  ): Promise<ActionResult> {
    const start = Date.now();

    const base = () => ({
      ...this.scope,
      actionId: request.actionId,
      startedAt: new Date(start).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
      evidenceRefs: [],
    });

    let acquired = false;

    try {
      const output = await this.bounded(
        options,
        () =>
          this.interruptOnDialog(
            async (): Promise<Extract<ActionResult, { status: 'success' }>['output']> => {
              if (this.busy) {
                throw new Fault('SURFACE_UNAVAILABLE', 'An action is in progress');
              }

              this.busy = true;
              acquired = true;

              const action = request.action;

              if (
                this.pending.size &&
                !(action.kind === 'dismiss' && action.dialog.kind === 'native')
              ) {
                throw new Fault(
                  'ACTION_FAILED',
                  'Pending native dialog requires explicit handling',
                );
              }

              const budget = {
                timeout: Math.max(1, options.timeoutMs - (Date.now() - start)),
              };

              if (action.kind === 'navigate') {
                const url = new URL(action.destination);

                if (!['http:', 'https:'].includes(url.protocol)) {
                  throw new Fault('UNSUPPORTED_OPERATION', 'Only HTTP navigation is supported');
                }

                try {
                  await this.page.goto(url.href, {
                    ...budget,
                    waitUntil: 'domcontentloaded',
                  });
                } catch {
                  throw new Fault('NAVIGATION_FAILED', 'Navigation did not complete');
                }
              } else if (action.kind === 'dismiss') {
                if (action.dialog.kind === 'native') {
                  this.current(action.dialog.observationId);

                  const pending = this.pending.get(action.dialog.dialogId);

                  if (!pending) {
                    throw new Fault('STALE_TARGET', 'Dialog no longer exists');
                  }

                  if (action.dialog.response.kind === 'accept') {
                    await pending.dialog.accept(action.dialog.response.promptText);
                  } else {
                    await pending.dialog.dismiss();
                  }

                  this.pending.delete(action.dialog.dialogId);
                } else {
                  await (await this.element(action.dialog.target)).click(budget);
                }
              } else {
                const el = await this.element(action.target);

                switch (action.kind) {
                  case 'click':
                    await el.click(budget);
                    break;

                  case 'type':
                    if (action.mode === 'replace') {
                      await el.fill(action.text, budget);
                    } else {
                      await el.focus();
                      await el.press('ControlOrMeta+End', budget);
                      await el.type(action.text, budget);
                    }
                    break;

                  case 'select':
                    await el.selectOption(
                      action.option.kind === 'label'
                        ? { label: action.option.label }
                        : { value: action.option.value },
                      budget,
                    );
                    break;

                  case 'check':
                    await el.check(budget);
                    break;

                  case 'uncheck':
                    await el.uncheck(budget);
                    break;

                  case 'read':
                    if (!(await el.isVisible())) {
                      throw new Fault('ACTION_FAILED', 'Read target is not visible');
                    }

                    return {
                      kind: 'read',
                      source: action.source,
                      value:
                        action.source === 'text'
                          ? await el.innerText()
                          : await el.inputValue(budget),
                    };

                  default:
                    throw new Fault('UNSUPPORTED_OPERATION', 'Unknown action');
                }
              }

              return { kind: 'none' };
            },
          ),
        true,
      );

      return {
        ...base(),
        status: 'success',
        output,
      };
    } catch (error) {
      return {
        ...base(),
        status: 'failure',
        error: failure(error),
      };
    } finally {
      if (acquired) {
        this.busy = false;
        this.invalidate();
      }
    }
  }

  private async check(condition: SurfaceCondition<ConditionTarget>): Promise<{
    passed: boolean;
    expected: JsonValue;
    observed: JsonValue;
  }> {
    let expected: JsonValue = true;
    let observed: JsonValue;

    switch (condition.kind) {
      case 'elementAbsent':
      case 'elementVisible':
      case 'valueEquals': {
        if (condition.target.kind === 'absent') {
          this.current(condition.target.observationId);

          observed = false;

          return {
            passed: condition.kind === 'elementAbsent',
            expected: condition.kind === 'elementAbsent' ? false : true,
            observed,
          };
        }

        const el = await this.element(condition.target.target);

        if (condition.kind === 'elementAbsent') {
          observed = true;
          expected = false;
        } else if (condition.kind === 'elementVisible') {
          observed = await el.isVisible();
        } else {
          expected = condition.expected;
          observed = await el.inputValue();
        }

        break;
      }

      case 'urlMatches':
        expected = condition.match.value;
        observed =
          condition.match.kind === 'pathname' ? new URL(this.page.url()).pathname : this.page.url();
        break;

      case 'loadingComplete':
        expected = 'complete';

        observed = await this.page.evaluate(() => {
          let busy = false;

          for (const element of document.querySelectorAll('[aria-busy="true"]')) {
            if (
              element instanceof HTMLElement &&
              element.checkVisibility({
                checkOpacity: true,
                checkVisibilityCSS: true,
              })
            ) {
              busy = true;
              break;
            }
          }

          let ready = false;

          for (const element of document.querySelectorAll('[data-surface-ready="true"]')) {
            if (
              element instanceof HTMLElement &&
              element.checkVisibility({
                checkOpacity: true,
                checkVisibilityCSS: true,
              })
            ) {
              ready = true;
              break;
            }
          }

          return busy ? 'loading' : ready ? 'complete' : 'unknown';
        });

        break;

      case 'textPresent': {
        const data = await this.page.evaluate(collect, {
          maxTextLength: 1_000_000,
          maxControls: 1,
        });

        const text = condition.caseSensitive ? data.visibleText : data.visibleText.toLowerCase();

        const wanted = condition.caseSensitive ? condition.text : condition.text.toLowerCase();

        observed = condition.match === 'exact' ? text === wanted : text.includes(wanted);

        break;
      }
    }

    return {
      passed: expected === observed,
      expected,
      observed,
    };
  }

  private async checkDuringTransition(condition: SurfaceCondition<ConditionTarget>): Promise<{
    passed: boolean;
    expected: JsonValue;
    observed: JsonValue;
  }> {
    try {
      return await this.check(condition);
    } catch (error) {
      if (error instanceof Fault) {
        throw error;
      }

      if (this.poisoned || this.page.isClosed()) {
        throw new Fault('SURFACE_UNAVAILABLE', 'Surface unavailable during condition evaluation');
      }

      return {
        passed: false,
        expected: 'stable surface for condition evaluation',
        observed: 'surface transitioning',
      };
    }
  }

  async evaluate(
    request: ConditionEvaluationRequest,
    options: ConditionWaitOptions & { signal?: AbortSignal },
  ): Promise<ConditionResult> {
    const start = Date.now();

    let attempts = 0;
    let expected: JsonValue = null;
    let observed: JsonValue = null;

    const base = () => ({
      ...this.scope,
      conditionId: request.conditionId,
      startedAt: new Date(start).toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
      attempts,
      expected,
      observed,
      evidenceRefs: [],
    });

    try {
      positive(options.timeoutMs);
      positive(options.pollIntervalMs);

      while (Date.now() - start < options.timeoutMs) {
        const remaining = options.timeoutMs - (Date.now() - start);

        const result = await this.bounded({ ...options, timeoutMs: remaining }, async () => {
          attempts++;

          const prepared = await request.prepare({
            ...options,
            timeoutMs: remaining,
          });

          if (prepared.status === 'failure') {
            throw new Fault(prepared.error.code, prepared.error.message);
          }

          if (this.pending.size) {
            throw new Fault(
              'CONDITION_EVALUATION_FAILED',
              'Native dialog blocks condition evaluation',
            );
          }

          return this.checkDuringTransition(prepared.condition);
        });

        expected = result.expected;
        observed = result.observed;

        if (result.passed) {
          return {
            ...base(),
            status: 'passed',
            passed: true,
          };
        }

        const delay = Math.min(options.pollIntervalMs, options.timeoutMs - (Date.now() - start));

        if (delay > 0) {
          await new Promise<void>((resolve, reject) => {
            const done = () => {
              options.signal?.removeEventListener('abort', abort);
              resolve();
            };

            const timer = setTimeout(done, delay);

            const abort = () => {
              clearTimeout(timer);
              options.signal?.removeEventListener('abort', abort);

              reject(new Fault('SURFACE_UNAVAILABLE', 'Wait cancelled'));
            };

            options.signal?.addEventListener('abort', abort, {
              once: true,
            });

            if (options.signal?.aborted) {
              abort();
            }
          });
        }
      }

      return {
        ...base(),
        status: 'not_met',
        passed: false,
        reason: 'timeout',
      };
    } catch (error) {
      if (error instanceof Fault && error.code === 'CONDITION_TIMEOUT') {
        return {
          ...base(),
          status: 'not_met',
          passed: false,
          reason: 'timeout',
        };
      }

      return {
        ...base(),
        status: 'error',
        passed: false,
        error: failure(error),
      };
    }
  }

  async captureEvidence(
    request: EvidenceCaptureRequest,
    options: SurfaceOperationOptions,
  ): Promise<EvidenceCaptureResult> {
    try {
      if (request.kind === 'snapshot') {
        const result = await this.observe({
          ...options,
          maxTextLength: 20_000,
          maxControls: 200,
        });

        if (result.status === 'failure') {
          return result;
        }

        return {
          status: 'success',
          evidence: {
            ...this.scope,
            kind: 'snapshot',
            mediaType: 'application/json',
            capturedAt: result.observation.capturedAt,
            observation: result.observation,
          },
        };
      }

      return await this.bounded(options, async () => {
        if (this.pending.size || this.busy) {
          throw new Fault('SURFACE_UNAVAILABLE', 'Screenshot unavailable while surface is blocked');
        }

        const bytes = await this.page.screenshot({
          type: 'png',
          fullPage: request.extent === 'full_surface',
          timeout: options.timeoutMs,
        });

        return {
          status: 'success',
          evidence: {
            ...this.scope,
            kind: 'screenshot',
            mediaType: 'image/png',
            capturedAt: new Date().toISOString(),
            bytes,
          },
        };
      });
    } catch (error) {
      return {
        status: 'failure',
        error: failure(error),
      };
    }
  }
}
