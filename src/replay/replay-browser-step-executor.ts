import type { CapabilityStep, WaitPolicy } from '../artifact/index.js';

import type { PolicyEngine } from '../policy/index.js';

import type {
  ActionResult,
  ExecutableSurfaceAction,
  ResolvedTarget,
  SurfaceAdapter,
} from '../surface/index.js';

import type { TargetStrategy } from '../targeting/index.js';

import { detectReplayApplicationError } from './replay-application-error.js';

import { recordReplayEvidence, type ReplayEvidenceSink } from './replay-evidence.js';

import {
  detectReplayBusinessOutcome,
  evaluateReplayPolicy,
  evaluateReplayPostconditions,
  evaluateReplayPreconditions,
  extractReplayOutput,
  resolveReplayStepTarget,
  resolveReplayStringInputBinding,
} from './index.js';

import type {
  ReplayExecutionContext,
  ReplayOrderedStepResult,
  ReplayStepExecutor,
} from './replay-engine.js';

import { captureReplayFailureEvidence } from './replay-failure-evidence.js';

import { recoverKnownReplayInterstitial } from './replay-known-interstitial.js';

import { performReplayOwnedAction } from './replay-owned-action.js';

import type { ReplayRuntimeSignal } from './replay-runtime-classifier.js';

const DEFAULT_WAIT: WaitPolicy = {
  timeoutMs: 5_000,

  pollIntervalMs: 100,
};

export interface ReplayBrowserStepExecutorOptions {
  readonly surface: SurfaceAdapter<TargetStrategy>;

  readonly policyEngine: PolicyEngine;

  readonly operationTimeoutMs?: number;

  readonly signal?: AbortSignal;

  readonly evidenceSink?: ReplayEvidenceSink;

  /**
   * Required ownership gate for every replay browser action.
   * The real runtime wires this to SessionManager.access('REPLAY').
   */
  readonly assertAutomationOwnership: () => void;

  readonly recordRecoveryAttempt?: (input: {
    readonly step: number;

    readonly stepId: string;

    readonly conditionCode: 'KNOWN_DIALOG' | 'KNOWN_INTERSTITIAL';

    readonly attempt: number;

    readonly outcome: string;
  }) => Promise<void>;
}

function failure(code: string, message: string): ReplayOrderedStepResult {
  return {
    status: 'failure',

    code,

    message,
  };
}

function currentUrl(
  observation: Awaited<ReturnType<SurfaceAdapter<TargetStrategy>['observe']>>,
): string | null {
  if (observation.status !== 'success') {
    return null;
  }

  const location = observation.observation.location;

  return location.kind === 'web' ? location.url : null;
}

function executableAction(
  step: CapabilityStep,

  target: ResolvedTarget | null,

  context: ReplayExecutionContext,
):
  | {
      readonly status: 'ready';

      readonly action: ExecutableSurfaceAction;
    }
  | {
      readonly status: 'failure';

      readonly message: string;
    } {
  switch (step.action.kind) {
    case 'click':
      if (target === null) {
        return {
          status: 'failure',

          message: 'Click action requires a resolved target.',
        };
      }

      return {
        status: 'ready',

        action: {
          kind: 'click',

          target,
        },
      };

    case 'type': {
      if (target === null) {
        return {
          status: 'failure',

          message: 'Type action requires a resolved target.',
        };
      }

      const binding = resolveReplayStringInputBinding(
        context.artifact,

        step.action.value,

        context.inputs,
      );

      if (binding.status === 'failure') {
        return {
          status: 'failure',

          message: binding.error.message,
        };
      }

      return {
        status: 'ready',

        action: {
          kind: 'type',

          target,

          text: binding.value,

          mode: step.action.mode,
        },
      };
    }

    case 'read':
      if (target === null) {
        return {
          status: 'failure',

          message: 'Read action requires a resolved target.',
        };
      }

      return {
        status: 'ready',

        action: {
          kind: 'read',

          target,

          source: step.action.source,
        },
      };

    case 'check':
      if (target === null) {
        return {
          status: 'failure',

          message: 'Check action requires a resolved target.',
        };
      }

      return {
        status: 'ready',

        action: {
          kind: 'check',

          target,
        },
      };

    case 'uncheck':
      if (target === null) {
        return {
          status: 'failure',

          message: 'Uncheck action requires a resolved target.',
        };
      }

      return {
        status: 'ready',

        action: {
          kind: 'uncheck',

          target,
        },
      };

    case 'select':
      return {
        status: 'failure',
        message: 'Real replay executor does not yet support artifact action "select".',
      };

    case 'navigate':
      return {
        status: 'failure',
        message: 'Real replay executor does not yet support artifact action "navigate".',
      };

    case 'wait':
      return {
        status: 'failure',
        message: 'Real replay executor does not yet support artifact action "wait".',
      };

    case 'dismiss':
      return {
        status: 'failure',
        message: 'Real replay executor does not yet support artifact action "dismiss".',
      };
  }
}

export class ReplayBrowserStepExecutor implements ReplayStepExecutor {
  private readonly operationTimeoutMs: number;

  constructor(private readonly options: ReplayBrowserStepExecutorOptions) {
    this.operationTimeoutMs = options.operationTimeoutMs ?? 5_000;
  }

  async execute(
    step: CapabilityStep,

    stepIndex: number,

    context: ReplayExecutionContext,
  ): Promise<ReplayOrderedStepResult> {
    const applicationError = await detectReplayApplicationError({
      adapter: this.options.surface,

      stepId: step.id,

      wait: {
        timeoutMs: 250,

        pollIntervalMs: 50,
      },

      captureEvidence: () => Promise.resolve([]),

      ...(this.options.signal === undefined
        ? {}
        : {
            signal: this.options.signal,
          }),
    });

    if (applicationError.signal.kind === 'failure') {
      await this.captureApplicationFailure(step, stepIndex, applicationError.signal);

      return failure(applicationError.signal.code, applicationError.signal.message);
    }

    const initialInterstitial = await recoverKnownReplayInterstitial({
      adapter: this.options.surface,

      assertAutomationOwnership: this.options.assertAutomationOwnership,

      step,

      timeoutMs: this.operationTimeoutMs,

      recordAttempt: (attempt) =>
        this.recordRecoveryAttempt({
          step: stepIndex,

          stepId: step.id,

          conditionCode: attempt.conditionCode,

          attempt: attempt.attempt,

          outcome: attempt.outcome,
        }),

      ...(this.options.signal === undefined
        ? {}
        : {
            signal: this.options.signal,
          }),
    });

    if (initialInterstitial.status === 'failure') {
      return failure(initialInterstitial.code, initialInterstitial.message);
    }

    if (initialInterstitial.status === 'intervention_required') {
      return {
        status: 'intervention_required',

        reasonCode: initialInterstitial.reasonCode,

        reason: initialInterstitial.reason,
      };
    }

    const preconditions = await evaluateReplayPreconditions({
      adapter: this.options.surface,

      step,

      defaultWait: DEFAULT_WAIT,

      ...(this.options.signal === undefined
        ? {}
        : {
            signal: this.options.signal,
          }),
    });

    if (preconditions.status === 'failure') {
      return failure(preconditions.error.code, preconditions.error.message);
    }

    if (this.options.evidenceSink !== undefined) {
      await recordReplayEvidence({
        sink: this.options.evidenceSink,

        eventType: 'precondition.passed',

        step: stepIndex,

        stepId: step.id,

        details: {
          count: step.preconditions?.length ?? 0,
        },
      });
    }

    const observation = await this.options.surface.observe({
      timeoutMs: this.operationTimeoutMs,

      maxTextLength: 10_000,

      maxControls: 200,

      ...(this.options.signal === undefined
        ? {}
        : {
            signal: this.options.signal,
          }),
    });

    if (observation.status === 'failure') {
      return failure(observation.error.code, observation.error.message);
    }

    const url = currentUrl(observation);

    if (url === null) {
      return failure('ACTION_FAILED', 'Replay requires a web URL for policy evaluation.');
    }

    const policy = evaluateReplayPolicy({
      step,

      url,

      policyEngine: this.options.policyEngine,
    });

    if (policy.status === 'failure') {
      return failure(policy.error.code, policy.error.message);
    }

    if (policy.status === 'intervention_required') {
      return {
        status: 'intervention_required',

        reasonCode: policy.intervention.code,

        reason: policy.intervention.message,
      };
    }

    if (this.options.evidenceSink !== undefined) {
      await recordReplayEvidence({
        sink: this.options.evidenceSink,

        eventType: 'policy.evaluated',

        step: stepIndex,

        stepId: step.id,

        details: {
          decision: 'ALLOW',

          actionKind: step.action.kind,

          storedRisk: step.risk,
        },
      });
    }

    /*
     * First ownership gate after runtime risk + policy authorization.
     *
     * Do not resolve targets after HUMAN has acquired the session.
     * performReplayOwnedAction() performs the second ownership check
     * immediately before SurfaceAdapter.perform().
     */
    try {
      this.options.assertAutomationOwnership();
    } catch (error) {
      return failure(
        'ACTION_FAILED',
        error instanceof Error
          ? `Replay lost session ownership before target resolution: ${error.message}`
          : 'Replay lost session ownership before target resolution.',
      );
    }

    let target: ResolvedTarget | null = null;

    if (step.target !== undefined) {
      const resolution = await resolveReplayStepTarget({
        adapter: this.options.surface,

        step,

        observationId: observation.observation.observationId,

        timeoutMs: this.operationTimeoutMs,

        ...(this.options.signal === undefined
          ? {}
          : {
              signal: this.options.signal,
            }),
      });

      if (resolution.status === 'failure') {
        return failure(resolution.error.code, resolution.error.message);
      }

      target = resolution.target;

      if (this.options.evidenceSink !== undefined) {
        await recordReplayEvidence({
          sink: this.options.evidenceSink,

          eventType: 'target.resolved',

          step: stepIndex,

          stepId: step.id,

          details: {
            resolved: true,
          },
        });
      }
    }

    const translated = executableAction(step, target, context);

    if (translated.status === 'failure') {
      return failure('ACTION_FAILED', translated.message);
    }

    const ownedAction = await performReplayOwnedAction({
      surface: this.options.surface,
      assertAutomationOwnership: this.options.assertAutomationOwnership,

      request: {
        actionId: `${stepIndex}:${step.id}`,
        action: translated.action,
      },

      options: {
        timeoutMs: this.operationTimeoutMs,
        ...(this.options.signal === undefined
          ? {}
          : {
              signal: this.options.signal,
            }),
      },
    });

    if (ownedAction.status === 'ownership_blocked') {
      return failure('ACTION_FAILED', ownedAction.message);
    }

    const actionResult = ownedAction.result;

    const interstitial = await recoverKnownReplayInterstitial({
      adapter: this.options.surface,

      assertAutomationOwnership: this.options.assertAutomationOwnership,

      step,

      timeoutMs: this.operationTimeoutMs,

      recordAttempt: (attempt) =>
        this.recordRecoveryAttempt({
          step: stepIndex,

          stepId: step.id,

          conditionCode: attempt.conditionCode,

          attempt: attempt.attempt,

          outcome: attempt.outcome,
        }),

      ...(this.options.signal === undefined
        ? {}
        : {
            signal: this.options.signal,
          }),
    });

    if (interstitial.status === 'failure') {
      return failure(interstitial.code, interstitial.message);
    }

    if (interstitial.status === 'intervention_required') {
      return {
        status: 'intervention_required',

        reasonCode: interstitial.reasonCode,

        reason: interstitial.reason,
      };
    }

    if (actionResult.status === 'failure') {
      return failure(actionResult.error.code, actionResult.error.message);
    }

    if (this.options.evidenceSink !== undefined) {
      await recordReplayEvidence({
        sink: this.options.evidenceSink,

        eventType: 'action.completed',

        step: stepIndex,

        stepId: step.id,

        details: {
          actionKind: step.action.kind,
        },
      });
    }

    const postActionApplicationError = await detectReplayApplicationError({
      adapter: this.options.surface,

      stepId: step.id,

      wait: {
        timeoutMs: 250,

        pollIntervalMs: 50,
      },

      captureEvidence: () => Promise.resolve([]),

      ...(this.options.signal === undefined
        ? {}
        : {
            signal: this.options.signal,
          }),
    });

    if (postActionApplicationError.signal.kind === 'failure') {
      await this.captureApplicationFailure(step, stepIndex, postActionApplicationError.signal);

      return failure(
        postActionApplicationError.signal.code,

        postActionApplicationError.signal.message,
      );
    }

    const outputResult = this.storeOutput(step, actionResult, context);

    if (outputResult !== null) {
      return outputResult;
    }

    if (step.action.kind === 'read' && this.options.evidenceSink !== undefined) {
      await recordReplayEvidence({
        sink: this.options.evidenceSink,

        eventType: 'output.extracted',

        step: stepIndex,

        stepId: step.id,

        details: {
          outputName: step.action.saveAs.name,
        },
      });
    }

    const postconditions = await evaluateReplayPostconditions({
      adapter: this.options.surface,

      step,

      defaultWait: DEFAULT_WAIT,

      detectCurrentState: async () => {
        const outcome = await detectReplayBusinessOutcome({
          adapter: this.options.surface,

          artifact: context.artifact,

          wait: step.wait ?? DEFAULT_WAIT,

          ...(this.options.signal === undefined
            ? {}
            : {
                signal: this.options.signal,
              }),
        });

        if (outcome.status === 'detected') {
          return {
            status: 'business_outcome',

            code: outcome.outcome.code,

            message: outcome.outcome.message,

            details: outcome.outcome.details,
          };
        }

        if (outcome.status === 'failure') {
          return {
            status: 'none',
          };
        }

        return {
          status: 'none',
        };
      },

      ...(this.options.signal === undefined
        ? {}
        : {
            signal: this.options.signal,
          }),
    });

    if (postconditions.status === 'business_outcome') {
      return {
        status: 'business_outcome',

        code: postconditions.outcome.code,

        ...(postconditions.outcome.details === undefined
          ? {}
          : {
              details: postconditions.outcome.details,
            }),
      };
    }

    if (postconditions.status === 'recoverable') {
      return failure(
        'CHECKPOINT_FAILED',

        `Replay step "${step.id}" entered recoverable condition "${postconditions.condition.code}" before recovery integration.`,
      );
    }

    if (postconditions.status === 'failure') {
      return failure(postconditions.error.code, postconditions.error.message);
    }

    if (this.options.evidenceSink !== undefined) {
      await recordReplayEvidence({
        sink: this.options.evidenceSink,

        eventType: 'postcondition.passed',

        step: stepIndex,

        stepId: step.id,

        details: {
          count: step.postconditions?.length ?? 0,
        },

        evidenceRefs: postconditions.evidenceRefs,
      });
    }

    return {
      status: 'success',
    };
  }

  private async recordRecoveryAttempt(input: {
    readonly step: number;

    readonly stepId: string;

    readonly conditionCode: 'KNOWN_DIALOG' | 'KNOWN_INTERSTITIAL';

    readonly attempt: number;

    readonly outcome: string;
  }): Promise<void> {
    if (this.options.evidenceSink !== undefined) {
      if (input.outcome === 'started') {
        await recordReplayEvidence({
          sink: this.options.evidenceSink,

          eventType: 'recovery.started',

          step: input.step,

          stepId: input.stepId,

          details: {
            conditionCode: input.conditionCode,

            attempt: input.attempt,
          },
        });
      }

      await recordReplayEvidence({
        sink: this.options.evidenceSink,

        eventType: 'recovery.attempted',

        step: input.step,

        stepId: input.stepId,

        details: {
          conditionCode: input.conditionCode,

          attempt: input.attempt,

          outcome: input.outcome,
        },
      });

      if (input.outcome === 'dismissed') {
        await recordReplayEvidence({
          sink: this.options.evidenceSink,

          eventType: 'recovery.succeeded',

          step: input.step,

          stepId: input.stepId,

          details: {
            conditionCode: input.conditionCode,

            attempt: input.attempt,
          },
        });
      }
    }

    if (this.options.recordRecoveryAttempt !== undefined) {
      await this.options.recordRecoveryAttempt(input);
    }
  }

  private async captureApplicationFailure(
    step: CapabilityStep,

    stepIndex: number,

    signal: Extract<
      ReplayRuntimeSignal,
      {
        readonly kind: 'failure';
      }
    >,
  ): Promise<void> {
    if (this.options.evidenceSink === undefined) {
      return;
    }

    await captureReplayFailureEvidence({
      surface: this.options.surface,

      sink: this.options.evidenceSink,

      step: stepIndex,

      stepId: step.id,

      failure: {
        code: signal.code,

        message: signal.message,

        expected: signal.expected,

        observed: signal.observed,

        ...(signal.details === undefined
          ? {}
          : {
              details: signal.details,
            }),
      },

      operationTimeoutMs: this.operationTimeoutMs,

      ...(this.options.signal === undefined
        ? {}
        : {
            signal: this.options.signal,
          }),
    });
  }

  private storeOutput(
    step: CapabilityStep,

    actionResult: ActionResult,

    context: ReplayExecutionContext,
  ): ReplayOrderedStepResult | null {
    if (step.action.kind !== 'read') {
      return null;
    }

    const extraction = extractReplayOutput({
      stepId: step.id,

      outputName: step.action.saveAs.name,

      actionResult,
    });

    if (extraction.status === 'failure') {
      return failure(extraction.error.code, extraction.error.message);
    }

    const stored = context.outputStore.store(step.action.saveAs, extraction.value);

    if (stored.status === 'failure') {
      return failure(stored.error.code, stored.error.message);
    }

    return null;
  }
}
