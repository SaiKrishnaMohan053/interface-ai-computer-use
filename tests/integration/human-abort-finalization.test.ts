import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  finalizeHumanAbort,
  InMemoryInterventionStore,
  InterventionController,
  InterventionManager,
  LiveInterventionRegistry,
} from '../../src/intervention/index.js';

import type { CoordinatedRunContext } from '../../src/runtime/index.js';

import { SessionManager, SessionManagerError } from '../../src/session/index.js';

import type { TargetStrategy } from '../../src/targeting/index.js';

describe('human abort finalization integration', () => {
  let session: SessionManager | undefined;

  afterEach(async () => {
    await session?.close();
    session = undefined;
  });

  it('keeps automation stopped after HUMAN abort, returns a terminal result, and finalizes the live session cleanly', async () => {
    session = await SessionManager.create({
      sessionId: 'session-human-abort-integration',
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
      runId: 'run-human-abort-integration',
      mode: 'REPLAY',
      sessionManager: session,
    } as unknown as CoordinatedRunContext<TargetStrategy>;

    const intervention = await controller.createAndPause({
      id: 'intervention-human-abort-integration',
      context,
      source: 'REPLAY',
      capabilityId: 'prepare_new_savings_subaccount',
      capabilityVersion: '1.0.0',
      stepId: 'confirm-create',
      reasonCode: 'HUMAN_APPROVAL_REQUIRED',
      reason: 'Final create requires human approval.',
      observedState: 'Sub-account review screen.',
      evidenceRefs: [],
    });

    expect(intervention.status).toBe('WAITING_FOR_HUMAN');
    expect(session.state).toBe('PAUSED');
    expect(session.owner).toBe('REPLAY');

    await controller.acquireHumanControl({
      interventionId: intervention.id,
      context,
      acquisitionId: 'acquisition-human-abort-integration',
      operatorId: 'operator-test',
    });

    expect(session.state).toBe('PAUSED');
    expect(session.owner).toBe('HUMAN');

    const aborted = await controller.abortHumanIntervention({
      interventionId: intervention.id,
      context,
      operatorId: 'operator-test',
    });

    expect(aborted.status).toBe('ABORTED');

    /*
     * Abort releases HUMAN without restoring REPLAY.
     * Automation therefore remains stopped.
     */
    expect(session.state).toBe('PAUSED');
    expect(session.owner).toBe('NONE');

    expect(() => session!.access('REPLAY')).toThrow(SessionManagerError);

    const storedAfterAbort = await manager.get(intervention.id);

    expect(storedAfterAbort.request.status).toBe('ABORTED');

    expect(
      storedAfterAbort.auditTrail.some((event) => event.type === 'automation.control_restored'),
    ).toBe(false);

    /*
     * RunCoordinator owns terminal session/evidence cleanup.
     * This integration seam models that authoritative cleanup by closing
     * the real SessionManager and returning the coordinator summary.
     */
    const fail = vi.fn(async () => {
      await session!.close();

      return {
        runId: 'run-human-abort-integration',
        mode: 'REPLAY' as const,
        status: 'failure' as const,
        startedAt: '2026-09-24T02:45:00.000Z',
        finishedAt: '2026-09-24T02:46:00.000Z',
        durationMs: 60_000,
        evidenceRefs: [],
      };
    });

    const terminal = await finalizeHumanAbort({
      interventionId: intervention.id,
      context,
      manager,

      coordinator: {
        fail,
      },

      liveRegistry: registry,
    });

    expect(fail).toHaveBeenCalledTimes(1);

    expect(terminal).toMatchObject({
      status: 'failure',

      error: {
        code: 'ACTION_FAILED',
        stepId: 'confirm-create',
        observed: 'HUMAN_ABORTED',

        details: {
          reason: 'HUMAN_ABORTED',
          interventionId: intervention.id,
          source: 'REPLAY',
        },
      },
    });

    /*
     * Terminal cleanup completed and the live handoff registry no longer
     * exposes this intervention.
     */
    expect(session.state).toBe('CLOSED');
    expect(session.owner).toBe('NONE');
    expect(registry.has(intervention.id)).toBe(false);

    /*
     * There is no path back into REPLAY after terminal abort.
     */
    expect(() => session!.access('REPLAY')).toThrow(SessionManagerError);
  });
});
