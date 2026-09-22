import type { CapabilityArtifact, CapabilityStep } from '../artifact/index.js';

import type { JsonValue } from '../surface/index.js';

import type {
  ReplayExecutionContext,
  ReplayOrderedExecutionResult,
  ReplayOrderedStepResult,
  ReplayStepExecutor,
} from './replay-engine.js';

import type { ReplayResumeResult } from './replay-resume.js';

import type { ReplayOutputStore } from './output-store.js';

export interface ReplayContinuationInput {
  readonly artifact: CapabilityArtifact;

  readonly inputs: Readonly<Record<string, JsonValue>>;

  /**
   * Reuse the same run-scoped output store so values
   * produced before the human handoff are preserved.
   */
  readonly outputStore: ReplayOutputStore;

  readonly stepExecutor: ReplayStepExecutor;

  /**
   * Must come from resolveReplayResume().
   * Only a verified manually resolved step may continue.
   */
  readonly resume: Extract<
    ReplayResumeResult,
    {
      readonly status: 'manual_step_resolved';
    }
  >;
}

function inconsistentStepFailure(stepsExecuted: number): ReplayOrderedExecutionResult {
  return {
    status: 'failure',

    stepsExecuted,

    stepId: null,

    error: {
      status: 'failure',
      code: 'ACTION_FAILED',

      message: 'Artifact step ordering became inconsistent during replay continuation.',
    },
  };
}

function invalidContinuationFailure(input: ReplayContinuationInput): ReplayOrderedExecutionResult {
  return {
    status: 'failure',

    stepsExecuted: input.resume.continueAtStepIndex,

    stepId: input.resume.stepId,

    error: {
      status: 'failure',

      code: 'ACTION_FAILED',

      message: 'Replay continuation point is inconsistent with the manually resolved step.',
    },
  };
}

/**
 * Continue deterministic replay after a human performed
 * the paused action and resolveReplayResume() verified the
 * paused step's postcondition against fresh state.
 *
 * The paused step is never re-executed here.
 */
export async function continueReplayAfterManualStep(
  input: ReplayContinuationInput,
): Promise<ReplayOrderedExecutionResult> {
  const pausedStep = input.artifact.steps[input.resume.resumedFromStepIndex];

  if (
    pausedStep === undefined ||
    pausedStep.id !== input.resume.stepId ||
    input.resume.continueAtStepIndex !== input.resume.resumedFromStepIndex + 1
  ) {
    return invalidContinuationFailure(input);
  }

  if (input.resume.continueAtStepIndex > input.artifact.steps.length) {
    return invalidContinuationFailure(input);
  }

  const context: ReplayExecutionContext = {
    artifact: input.artifact,
    inputs: input.inputs,
    outputStore: input.outputStore,
  };

  /*
   * Count the manually resolved paused step as completed.
   * Earlier steps were already completed before escalation.
   */
  let stepsExecuted = input.resume.continueAtStepIndex;

  for (
    let stepIndex = input.resume.continueAtStepIndex;
    stepIndex < input.artifact.steps.length;
    stepIndex += 1
  ) {
    const step: CapabilityStep | undefined = input.artifact.steps[stepIndex];

    if (step === undefined) {
      return inconsistentStepFailure(stepsExecuted);
    }

    const result: ReplayOrderedStepResult = await input.stepExecutor.execute(
      step,
      stepIndex,
      context,
    );

    switch (result.status) {
      case 'success':
        stepsExecuted += 1;
        break;

      case 'business_outcome':
        return {
          status: 'business_outcome',

          stepsExecuted,

          stepId: step.id,

          outcome: result,
        };

      case 'intervention_required':
        return {
          status: 'intervention_required',

          stepsExecuted,

          stepId: step.id,

          intervention: result,
        };

      case 'failure':
        return {
          status: 'failure',

          stepsExecuted,

          stepId: step.id,

          error: result,
        };
    }
  }

  const outputs = input.outputStore.finalize();

  if (outputs.status === 'failure') {
    return {
      status: 'failure',

      stepsExecuted,

      stepId: null,

      error: {
        status: 'failure',

        code: outputs.error.code,

        message: outputs.error.message,
      },
    };
  }

  return {
    status: 'success',

    stepsExecuted,

    outputs: outputs.outputs,
  };
}
