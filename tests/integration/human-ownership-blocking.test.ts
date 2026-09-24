import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  InMemoryInterventionStore,
  InterventionController,
  InterventionManager,
  LiveInterventionRegistry,
} from '../../src/intervention/index.js';

import { performReplayOwnedAction } from '../../src/replay/index.js';

import type { CoordinatedRunContext } from '../../src/runtime/index.js';

import { SessionManager } from '../../src/session/index.js';

describe('HUMAN ownership blocks replay browser actions', () => {
  let session: SessionManager | undefined;

  afterEach(async () => {
    await session?.close();
    session = undefined;
  });

  it('rejects replay before surface.perform while HUMAN owns the paused live session', async () => {
    session = await SessionManager.create({
      sessionId: 'session-human-ownership-blocking',
      headed: false,
    });

    session.activate();
    session.acquireOwnership('REPLAY');

    const manager = new InterventionManager({
      store: new InMemoryInterventionStore(),
    });

    const registry = new LiveInterventionRegistry();
    const controller = new InterventionController(manager, registry);

    const context = {
      runId: 'run-human-ownership-blocking',
      mode: 'REPLAY',
      sessionManager: session,
    } as unknown as CoordinatedRunContext<unknown>;

    const intervention = await controller.createAndPause({
      id: 'intervention-human-ownership-blocking',
      context,
      source: 'REPLAY',
      capabilityId: 'prepare_new_savings_subaccount',
      capabilityVersion: '1.0.0',
      stepId: 'confirm-create',
      reasonCode: 'HUMAN_APPROVAL_REQUIRED',
      reason: 'Final create action requires human control.',
      observedState: 'Review screen is paused before final create.',
      evidenceRefs: [],
    });

    await controller.acquireHumanControl({
      interventionId: intervention.id,
      context,
      acquisitionId: 'acquisition-human-ownership-blocking',
      operatorId: 'operator-test',
    });

    expect(session.state).toBe('PAUSED');
    expect(session.owner).toBe('HUMAN');

    /*
     * 5.38 proof target:
     * even if replay code attempts to cross the final browser-action
     * boundary during HUMAN ownership, ownership validation must reject
     * the request before SurfaceAdapter.perform() is invoked.
     */
    const perform = vi.fn(() =>
      Promise.reject(new Error('surface.perform must never execute while HUMAN owns the session')),
    );

    const result = await performReplayOwnedAction({
      surface: {
        perform,
      },

      /*
       * The request is intentionally minimal because ownership must block
       * before the surface can inspect or execute it.
       */
      request: {
        actionId: 'blocked-during-human-ownership',
        action: {
          kind: 'navigate',
          destination: 'http://example.test',
        },
      },

      options: {
        timeoutMs: 1_000,
      },

      assertAutomationOwnership: () => {
        /*
         * SessionManager.access('REPLAY') is the authoritative final
         * ownership assertion used by real replay wiring.
         *
         * It must throw because the session is PAUSED and HUMAN-owned.
         */
        session!.access('REPLAY');
      },
    });

    expect(result.status).toBe('ownership_blocked');
    expect(perform).not.toHaveBeenCalled();

    /*
     * Blocking replay must not disturb HUMAN ownership or close the session.
     */
    expect(session.state).toBe('PAUSED');
    expect(session.owner).toBe('HUMAN');

    const humanAccess = session.access('HUMAN');

    expect(humanAccess.page.isClosed()).toBe(false);
  });
});
