import type { CapabilityStep } from '../artifact/index.js';

import type { JsonValue, SurfaceObservation } from '../surface/index.js';

export type ReplayResumePostconditionResult =
  | {
      readonly status: 'passed';
    }
  | {
      readonly status: 'not_satisfied';

      readonly reason: string;

      readonly details?: Readonly<Record<string, JsonValue>>;
    };

export type ReplayResumeResult =
  | {
      readonly status: 'manual_step_resolved';

      readonly stepId: string;

      readonly resumedFromStepIndex: number;

      readonly continueAtStepIndex: number;

      readonly freshObservationId: string;
    }
  | {
      readonly status: 'intervention_required';

      readonly reasonCode: 'RECOVERY_EXHAUSTED';

      readonly reason: string;

      readonly stepId: string;

      readonly freshObservationId: string;

      readonly details: Readonly<Record<string, JsonValue>>;
    }
  | {
      readonly status: 'failure';

      readonly code: 'ACTION_FAILED';

      readonly message: string;

      readonly stepId: string;

      readonly details: Readonly<Record<string, JsonValue>>;
    };

export interface ReplayResumeInput {
  readonly step: CapabilityStep;

  readonly stepIndex: number;

  /**
   * Observation that existed before HUMAN acquired control.
   * It is diagnostic only and must never be reused for the
   * resume decision.
   */
  readonly staleObservationId?: string | undefined;

  /**
   * Must observe the current live surface after automation
   * ownership has been restored.
   */
  readonly observeFresh: () => Promise<SurfaceObservation>;

  /**
   * Validates the paused step's postcondition using the
   * fresh post-human state. No action execution belongs
   * inside this callback.
   */
  readonly evaluatePausedStepPostconditions: (
    observation: SurfaceObservation,
  ) => Promise<ReplayResumePostconditionResult>;
}

/**
 * Determines a safe deterministic continuation point after
 * a HUMAN -> REPLAY handoff.
 *
 * This function deliberately does not execute or retry the
 * paused action.
 *
 * Resume protocol:
 *
 * restored REPLAY ownership
 * -> fresh observation
 * -> paused-step postcondition validation
 * -> if satisfied, mark the human-performed step resolved
 * -> continue at the next artifact step
 *
 * If the postcondition is not satisfied, replay stops and
 * requires explicit handling. This prevents double-submit
 * of irreversible actions.
 */
export async function resolveReplayResume(input: ReplayResumeInput): Promise<ReplayResumeResult> {
  if (!Number.isInteger(input.stepIndex) || input.stepIndex < 0) {
    return {
      status: 'failure',

      code: 'ACTION_FAILED',

      message: 'Replay resume requires a valid paused step index.',

      stepId: input.step.id,

      details: {
        reason: 'INVALID_RESUME_STEP_INDEX',

        stepIndex: input.stepIndex,
      },
    };
  }

  const freshObservation = await input.observeFresh();

  if (
    input.staleObservationId !== undefined &&
    freshObservation.observationId === input.staleObservationId
  ) {
    return {
      status: 'failure',

      code: 'ACTION_FAILED',

      message: 'Replay resume received the stale pre-human observation.',

      stepId: input.step.id,

      details: {
        reason: 'STALE_RESUME_OBSERVATION',

        observationId: freshObservation.observationId,
      },
    };
  }

  const postconditions = await input.evaluatePausedStepPostconditions(freshObservation);

  if (postconditions.status === 'passed') {
    return {
      status: 'manual_step_resolved',

      stepId: input.step.id,

      resumedFromStepIndex: input.stepIndex,

      continueAtStepIndex: input.stepIndex + 1,

      freshObservationId: freshObservation.observationId,
    };
  }

  return {
    status: 'intervention_required',

    reasonCode: 'RECOVERY_EXHAUSTED',

    reason: `Human-resolved replay step "${input.step.id}" did not satisfy its declared postcondition after resume.`,

    stepId: input.step.id,

    freshObservationId: freshObservation.observationId,

    details: {
      reason: 'HUMAN_ACTION_POSTCONDITION_NOT_SATISFIED',

      ...(postconditions.details === undefined ? {} : postconditions.details),
    },
  };
}
