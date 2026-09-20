import type { CapabilityStep, WaitPolicy } from '../artifact/index.js';

import type {
  ActionResult,
  ExecutableSurfaceAction,
  ResolvedTarget,
  SurfaceAdapter,
} from '../surface/index.js';

import type { TargetStrategy } from '../targeting/index.js';

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

import type { PolicyEngine } from '../policy/index.js';

const DEFAULT_WAIT: WaitPolicy = {
  timeoutMs: 5_000,
  pollIntervalMs: 100,
};

export interface ReplayBrowserStepExecutorOptions {
  readonly surface: SurfaceAdapter<TargetStrategy>;

  readonly policyEngine: PolicyEngine;

  readonly operationTimeoutMs?: number;

  readonly signal?: AbortSignal;
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
    case 'navigate':
    case 'wait':
    case 'dismiss':
      return {
        status: 'failure',
        message: `Real replay executor does not yet support artifact action "${step.action.kind}".`,
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
    }

    const translated = executableAction(step, target, context);

    if (translated.status === 'failure') {
      return failure('ACTION_FAILED', translated.message);
    }

    const actionResult = await this.options.surface.perform(
      {
        actionId: `${stepIndex}:${step.id}`,

        action: translated.action,
      },

      {
        timeoutMs: this.operationTimeoutMs,

        ...(this.options.signal === undefined
          ? {}
          : {
              signal: this.options.signal,
            }),
      },
    );

    if (actionResult.status === 'failure') {
      return failure(actionResult.error.code, actionResult.error.message);
    }

    const outputResult = this.storeOutput(step, actionResult, context);

    if (outputResult !== null) {
      return outputResult;
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

    return {
      status: 'success',
    };
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
