import { describe, expect, it } from 'vitest';

import {
  InMemoryInterventionStore,
  InterventionController,
  InterventionManager,
  LiveInterventionRegistry,
} from '../../src/intervention/index.js';

import type { CoordinatedRunContext } from '../../src/runtime/index.js';
import type { SessionManager } from '../../src/session/index.js';

const TIMES = [
  '2026-09-22T04:00:00.000Z',
  '2026-09-22T04:00:01.000Z',
  '2026-09-22T04:00:02.000Z',
  '2026-09-22T04:00:03.000Z',
  '2026-09-22T04:00:04.000Z',
];

class FakeSessionManager {
  readonly sessionId = 'session-audit';

  state: 'ACTIVE' | 'PAUSED' = 'ACTIVE';

  owner: 'DISCOVERY' | 'REPLAY' | 'HUMAN' | 'NONE' = 'DISCOVERY';

  pause(requestedBy: 'DISCOVERY' | 'REPLAY' | 'HUMAN' | 'NONE'): void {
    if (this.state !== 'ACTIVE' || this.owner !== requestedBy) {
      throw new Error('Invalid pause');
    }

    this.state = 'PAUSED';
  }

  transferOwnership(
    from: 'DISCOVERY' | 'REPLAY' | 'HUMAN',
    to: 'DISCOVERY' | 'REPLAY' | 'HUMAN',
  ): void {
    if (this.state !== 'PAUSED' || this.owner !== from) {
      throw new Error('Invalid transfer');
    }

    this.owner = to;
  }
}

function context(session: FakeSessionManager): CoordinatedRunContext<unknown> {
  return {
    runId: 'run-audit',
    mode: 'DISCOVERY',
    sessionManager: session as unknown as SessionManager,
  } as unknown as CoordinatedRunContext<unknown>;
}

describe('manual human action audit persistence', () => {
  it('persists an ordered semantic trail from intervention creation through human action', async () => {
    let timeIndex = 0;
    let eventIndex = 0;

    const store = new InMemoryInterventionStore();

    const manager = new InterventionManager({
      store,

      now: () => TIMES[Math.min(timeIndex++, TIMES.length - 1)]!,

      auditEventId: () => `audit-${++eventIndex}`,
    });

    const registry = new LiveInterventionRegistry();

    const controller = new InterventionController(manager, registry);

    const session = new FakeSessionManager();

    const liveContext = context(session);

    await controller.createAndPause({
      id: 'intervention-audit',
      context: liveContext,
      source: 'DISCOVERY',
      goal: 'Prepare savings account review',
      reasonCode: 'HUMAN_APPROVAL_REQUIRED',
      reason: 'Final action requires human approval',
      observedState: 'Review screen',
      evidenceRefs: [],
    });

    let stored = await manager.get('intervention-audit');

    expect(stored.auditTrail.map((event) => event.type)).toEqual(['intervention.created']);

    expect(session.state).toBe('PAUSED');

    await controller.acquireHumanControl({
      interventionId: 'intervention-audit',
      context: liveContext,
      acquisitionId: 'acquisition-audit',
      operatorId: 'operator-audit',
    });

    expect(session.owner).toBe('HUMAN');

    stored = await manager.get('intervention-audit');

    expect(stored.auditTrail.map((event) => event.type)).toEqual([
      'intervention.created',
      'human.acquire_requested',
      'human.control_acquired',
    ]);

    await controller.markHumanWorkInProgress('intervention-audit');

    await controller.recordManualAction({
      interventionId: 'intervention-audit',
      operatorId: 'operator-audit',
      summary:
        'Operator reviewed the final account details and performed the required manual step.',
      evidenceRefs: ['evidence-human-step'],
    });

    stored = await manager.get('intervention-audit');

    expect(stored.auditTrail.map((event) => event.type)).toEqual([
      'intervention.created',
      'human.acquire_requested',
      'human.control_acquired',
      'human.action_performed',
    ]);

    const manualEvent = stored.auditTrail.at(-1);

    expect(manualEvent).toMatchObject({
      actor: 'HUMAN',
      operatorId: 'operator-audit',
      summary:
        'Operator reviewed the final account details and performed the required manual step.',
      evidenceRefs: ['evidence-human-step'],
    });

    expect(manualEvent).not.toHaveProperty('coordinates');

    expect(manualEvent).not.toHaveProperty('keystrokes');

    expect(manualEvent).not.toHaveProperty('page');

    expect(manualEvent).not.toHaveProperty('context');
  });

  it('rejects manual action audit before human control is acquired', async () => {
    const store = new InMemoryInterventionStore();

    const manager = new InterventionManager({
      store,
      auditEventId: () => 'audit-created',
    });

    const controller = new InterventionController(manager);

    await manager.create({
      id: 'intervention-not-acquired',
      sessionId: 'session-audit',
      source: 'DISCOVERY',
      reasonCode: 'AUTOMATION_STUCK',
      reason: 'Needs human',
      observedState: 'Blocked',
    });

    await expect(
      controller.recordManualAction({
        interventionId: 'intervention-not-acquired',
        summary: 'Should not be accepted',
      }),
    ).rejects.toThrow('Manual human action requires ACQUIRED or IN_PROGRESS');
  });
});
