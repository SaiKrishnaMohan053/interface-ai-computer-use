import { describe, expect, it, vi } from 'vitest';

import {
  finalizeHumanAbort,
  InMemoryInterventionStore,
  InterventionManager,
  LiveInterventionRegistry,
} from '../../src/intervention/index.js';

import type { CoordinatedRunContext } from '../../src/runtime/index.js';

import type { SessionManager } from '../../src/session/index.js';

import type { TargetStrategy } from '../../src/targeting/index.js';

const NOW = '2026-09-22T18:10:00.000Z';

class FakeSessionManager {
  readonly sessionId = 'session-abort-finalizer';

  state: 'PAUSED' | 'FAILED' = 'PAUSED';

  readonly owner = 'NONE' as const;

  snapshot() {
    return {
      sessionId: this.sessionId,

      state: this.state,

      owner: this.owner,

      failureReason: this.state === 'FAILED' ? 'SESSION_FAILURE' : null,
    } as const;
  }
}

function context(session: FakeSessionManager): CoordinatedRunContext<TargetStrategy> {
  return {
    runId: 'run-abort-finalizer',

    mode: 'REPLAY',

    sessionManager: session as unknown as SessionManager,
  } as unknown as CoordinatedRunContext<TargetStrategy>;
}

describe('human abort terminal finalization', () => {
  it('maps ABORTED intervention into canonical terminal failure and delegates cleanup to coordinator', async () => {
    const store = new InMemoryInterventionStore();

    const manager = new InterventionManager({
      store,

      now: () => NOW,
    });

    await manager.create({
      id: 'intervention-aborted',

      sessionId: 'session-abort-finalizer',

      source: 'REPLAY',

      stepId: 'confirm-create',

      reasonCode: 'HUMAN_APPROVAL_REQUIRED',

      reason: 'Final create requires human approval.',

      observedState: 'Review screen.',
    });

    await manager.transition('intervention-aborted', 'WAITING_FOR_HUMAN');

    await manager.acquire({
      interventionId: 'intervention-aborted',

      sessionId: 'session-abort-finalizer',

      acquisitionId: 'acquisition-aborted',
    });

    await manager.abort('intervention-aborted', {
      kind: 'ABORT',
      code: 'HUMAN_ABORTED',
      summary: 'Human operator aborted automation.',
      resolvedAt: NOW,
      evidenceRefs: [],
    });

    const registry = new LiveInterventionRegistry();

    const session = new FakeSessionManager();

    const liveContext = context(session);

    registry.register({
      interventionId: 'intervention-aborted',
      context: liveContext,
    });

    const fail = vi.fn(() => {
      session.state = 'FAILED';

      return Promise.resolve({
        runId: 'run-abort-finalizer',
        mode: 'REPLAY' as const,
        status: 'failure' as const,
        startedAt: '2026-09-22T18:00:00.000Z',
        finishedAt: NOW,
        durationMs: 600_000,
        evidenceRefs: [],
      });
    });

    const result = await finalizeHumanAbort({
      interventionId: 'intervention-aborted',

      context: liveContext,

      manager,

      coordinator: {
        fail,
      },

      liveRegistry: registry,
    });

    expect(fail).toHaveBeenCalledTimes(1);

    expect(result).toMatchObject({
      status: 'failure',

      error: {
        code: 'ACTION_FAILED',

        stepId: 'confirm-create',

        observed: 'HUMAN_ABORTED',

        details: {
          reason: 'HUMAN_ABORTED',

          interventionId: 'intervention-aborted',
        },
      },
    });

    expect(registry.has('intervention-aborted')).toBe(false);
  });

  it('refuses to finalize a non-aborted intervention', async () => {
    const manager = new InterventionManager({
      store: new InMemoryInterventionStore(),

      now: () => NOW,
    });

    await manager.create({
      id: 'intervention-not-aborted',

      sessionId: 'session-abort-finalizer',

      source: 'REPLAY',

      reasonCode: 'HUMAN_APPROVAL_REQUIRED',

      reason: 'Human required.',

      observedState: 'Review screen.',
    });

    const fail = vi.fn();

    await expect(
      finalizeHumanAbort({
        interventionId: 'intervention-not-aborted',

        context: context(new FakeSessionManager()),

        manager,

        coordinator: {
          fail: fail as never,
        },
      }),
    ).rejects.toThrow('requires ABORTED status');

    expect(fail).not.toHaveBeenCalled();
  });
});
