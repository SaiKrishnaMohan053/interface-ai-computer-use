import type { CoordinatedRunContext } from '../runtime/index.js';

import type { JsonValue, SurfaceObservation } from '../surface/index.js';

import type { TargetStrategy } from '../targeting/index.js';

import type { AgentObservation } from './agent-observation.js';

import type { DiscoveryDecision } from './decision.js';

import { projectObservationForAgent } from './observation-projector.js';

export type DiscoveryResumeResult =
  | {
      readonly status: 'continued';

      readonly observation: AgentObservation;

      readonly decision: DiscoveryDecision;
    }
  | {
      readonly status: 'failure';

      readonly code: 'ACTION_FAILED' | 'INVALID_INPUT';

      readonly message: string;

      readonly details: Readonly<Record<string, JsonValue>>;
    };

export interface DiscoveryResumeInput {
  readonly context: CoordinatedRunContext<TargetStrategy>;

  readonly goal: string;

  readonly step: number;

  readonly staleObservationId?: string | undefined;

  readonly extractedValues?: Readonly<Record<string, JsonValue>>;

  /**
   * Reads the live surface after ownership has already
   * returned to DISCOVERY.
   */
  readonly observeFresh: () => Promise<SurfaceObservation>;

  /**
   * Receives only the newly projected/sanitized
   * observation. Production wiring can delegate this
   * callback to the existing DiscoveryDecisionModel.
   */
  readonly decideWithFreshObservation: (
    observation: AgentObservation,
  ) => Promise<DiscoveryDecision>;
}

/**
 * Safe discovery continuation after HUMAN -> DISCOVERY.
 *
 * This helper intentionally has no input for a previously
 * projected AgentObservation, so stale model context cannot
 * be reused accidentally.
 */
export async function continueDiscoveryAfterHuman(
  input: DiscoveryResumeInput,
): Promise<DiscoveryResumeResult> {
  const snapshot = input.context.sessionManager.snapshot();

  if (input.context.mode !== 'DISCOVERY') {
    return {
      status: 'failure',

      code: 'INVALID_INPUT',

      message: 'Discovery resume requires a DISCOVERY coordinated run.',

      details: {
        reason: 'WRONG_RUN_MODE',

        mode: input.context.mode,
      },
    };
  }

  if (snapshot.state !== 'ACTIVE' || snapshot.owner !== 'DISCOVERY') {
    return {
      status: 'failure',

      code: 'ACTION_FAILED',

      message: 'Discovery resume requires an active session owned by DISCOVERY.',

      details: {
        reason: 'DISCOVERY_OWNERSHIP_NOT_RESTORED',

        sessionState: snapshot.state,

        sessionOwner: snapshot.owner,
      },
    };
  }

  if (!Number.isInteger(input.step) || input.step < 0) {
    return {
      status: 'failure',

      code: 'INVALID_INPUT',

      message: 'Discovery resume requires a non-negative step number.',

      details: {
        reason: 'INVALID_DISCOVERY_RESUME_STEP',

        step: input.step,
      },
    };
  }

  const freshSurfaceObservation = await input.observeFresh();

  if (
    input.staleObservationId !== undefined &&
    freshSurfaceObservation.observationId === input.staleObservationId
  ) {
    return {
      status: 'failure',

      code: 'ACTION_FAILED',

      message: 'Discovery resume received the stale pre-human observation.',

      details: {
        reason: 'STALE_DISCOVERY_RESUME_OBSERVATION',

        observationId: freshSurfaceObservation.observationId,
      },
    };
  }

  const observation = projectObservationForAgent({
    goal: input.goal,
    step: input.step,

    observation: freshSurfaceObservation,

    extractedValues: input.extractedValues ?? {},

    recentAction: null,
    recentCondition: null,
    recentError: null,
  });

  const decision = await input.decideWithFreshObservation(observation);

  return {
    status: 'continued',
    observation,
    decision,
  };
}
