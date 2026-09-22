import { parseRuntimeResult } from '../runtime/index.js';

import type { CoordinatedRunContext, RunCoordinator, RuntimeFailure } from '../runtime/index.js';

import type { TargetStrategy } from '../targeting/index.js';

import type { LiveInterventionRegistry } from './live-intervention-registry.js';

import type { InterventionManager } from './intervention-manager.js';

export type HumanAbortCoordinator = Pick<RunCoordinator<TargetStrategy>, 'fail'>;

export interface FinalizeHumanAbortInput {
  readonly interventionId: string;

  readonly context: CoordinatedRunContext<TargetStrategy>;

  readonly manager: InterventionManager;

  readonly coordinator: HumanAbortCoordinator;

  readonly liveRegistry?: LiveInterventionRegistry | undefined;
}

/**
 * Converts an already-persisted human ABORT decision into
 * the canonical terminal runtime result and lets
 * RunCoordinator own session/evidence cleanup.
 */
export async function finalizeHumanAbort(input: FinalizeHumanAbortInput): Promise<RuntimeFailure> {
  const stored = await input.manager.get(input.interventionId);

  if (stored.request.status !== 'ABORTED') {
    throw new Error(
      `Human abort finalization requires ABORTED status; received ${stored.request.status}`,
    );
  }

  if (stored.request.sessionId !== input.context.sessionManager.sessionId) {
    throw new Error('Human abort finalization session does not match the intervention session');
  }

  const snapshot = input.context.sessionManager.snapshot();

  if (snapshot.state !== 'PAUSED' || snapshot.owner !== 'NONE') {
    throw new Error(
      `Human abort finalization requires PAUSED/NONE session state; received ${snapshot.state}/${snapshot.owner}`,
    );
  }

  const error = {
    code: 'ACTION_FAILED' as const,

    message: 'Automation was aborted by the human operator.',

    stepId: stored.request.stepId ?? null,

    expected: 'automation continuation',

    observed: 'HUMAN_ABORTED',

    details: {
      reason: 'HUMAN_ABORTED',

      interventionId: stored.request.id,

      source: stored.request.source,
    },
  };

  const summary = await input.coordinator.fail(error);

  input.liveRegistry?.remove(input.interventionId);

  const result = parseRuntimeResult({
    runId: summary.runId,

    sessionId: input.context.sessionManager.sessionId,

    startedAt: summary.startedAt,

    finishedAt: summary.finishedAt,

    durationMs: summary.durationMs,

    evidenceRefs: summary.evidenceRefs,

    recoverableConditions: [],

    status: 'failure',

    error,
  });

  if (result.status !== 'failure') {
    throw new Error('Human abort finalization did not produce a failure result');
  }

  return result;
}
