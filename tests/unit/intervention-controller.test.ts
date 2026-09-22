import { describe, expect, it } from 'vitest';

import {
  InMemoryInterventionStore,
  InterventionController,
  InterventionManager,
} from '../../src/intervention/index.js';

import type { CoordinatedRunContext } from '../../src/runtime/index.js';
import type { SessionManager } from '../../src/session/index.js';

const NOW = '2026-09-21T22:30:00.000Z';

class FakeSessionManager {
  readonly sessionId = 'session-1';

  state: 'ACTIVE' | 'PAUSED' = 'ACTIVE';

  owner: 'DISCOVERY' | 'REPLAY' | 'HUMAN' | 'NONE';

  pauseCalls = 0;

  transferCalls = 0;

  constructor(owner: 'DISCOVERY' | 'REPLAY' | 'HUMAN' | 'NONE' = 'DISCOVERY') {
    this.owner = owner;
  }

  pause(requestedBy: 'DISCOVERY' | 'REPLAY' | 'HUMAN' | 'NONE'): void {
    if (this.state !== 'ACTIVE') {
      throw new Error(`Expected ACTIVE session, received ${this.state}`);
    }

    if (this.owner !== requestedBy) {
      throw new Error(`Expected owner ${requestedBy}, received ${this.owner}`);
    }

    this.pauseCalls += 1;
    this.state = 'PAUSED';
  }

  transferOwnership(
    from: 'DISCOVERY' | 'REPLAY' | 'HUMAN',
    to: 'DISCOVERY' | 'REPLAY' | 'HUMAN',
  ): void {
    if (this.state !== 'PAUSED') {
      throw new Error(`Expected PAUSED session, received ${this.state}`);
    }

    if (this.owner !== from) {
      throw new Error(`Expected owner ${from}, received ${this.owner}`);
    }

    if (from === to) {
      throw new Error('Ownership transfer requires a new owner');
    }

    this.transferCalls += 1;
    this.owner = to;
  }
}

function coordinatedContext(session: FakeSessionManager): CoordinatedRunContext<unknown> {
  /*
   * InterventionController only depends on SessionManager identity,
   * state, owner, pause, and ownership-transfer semantics here.
   * Real BrowserContext/Page continuity is covered by the
   * SessionManager integration tests.
   */
  return {
    runId: 'run-1',

    mode: session.owner === 'REPLAY' ? 'REPLAY' : 'DISCOVERY',

    sessionManager: session as unknown as SessionManager,
  } as unknown as CoordinatedRunContext<unknown>;
}

function fixture(owner: 'DISCOVERY' | 'REPLAY' | 'HUMAN' | 'NONE' = 'DISCOVERY') {
  const store = new InMemoryInterventionStore();

  const manager = new InterventionManager({
    store,
    now: () => NOW,
  });

  const controller = new InterventionController(manager);

  const session = new FakeSessionManager(owner);

  return {
    store,
    manager,
    controller,
    session,
    context: coordinatedContext(session),
  };
}

describe('InterventionController', () => {
  it('creates a persisted intervention and pauses discovery automation', async () => {
    const test = fixture('DISCOVERY');

    const intervention = await test.controller.createAndPause({
      context: test.context,
      id: 'intervention-1',
      source: 'DISCOVERY',
      goal: 'Read the member savings balance',
      stepId: '4',
      reasonCode: 'AUTOMATION_STUCK',
      reason: 'Discovery cannot safely continue',
      observedState: 'Member details page with no unique safe target',
      evidenceRefs: [],
    });

    expect(intervention).toMatchObject({
      id: 'intervention-1',
      sessionId: 'session-1',
      source: 'DISCOVERY',
      reasonCode: 'AUTOMATION_STUCK',
      status: 'WAITING_FOR_HUMAN',
    });

    expect(test.session.state).toBe('PAUSED');

    expect(test.session.owner).toBe('DISCOVERY');

    expect(test.session.pauseCalls).toBe(1);

    const stored = await test.manager.get('intervention-1');

    expect(stored.request).toEqual(intervention);

    expect(stored.humanActions).toEqual([]);

    expect(stored.acquisition).toBeUndefined();

    expect(stored.resolution).toBeUndefined();
  });

  it('creates a persisted intervention and pauses replay automation', async () => {
    const test = fixture('REPLAY');

    const intervention = await test.controller.createAndPause({
      context: test.context,
      id: 'intervention-2',
      source: 'REPLAY',
      capabilityId: 'prepare_new_savings_subaccount',
      capabilityVersion: '1.0.0',
      stepId: 'confirm-create',
      reasonCode: 'HUMAN_APPROVAL_REQUIRED',
      reason: 'Final create requires human involvement',
      observedState: 'Sub-account review screen',
      evidenceRefs: [],
    });

    expect(intervention).toMatchObject({
      id: 'intervention-2',
      sessionId: 'session-1',
      source: 'REPLAY',
      capabilityId: 'prepare_new_savings_subaccount',
      capabilityVersion: '1.0.0',
      status: 'WAITING_FOR_HUMAN',
    });

    expect(test.session.state).toBe('PAUSED');

    expect(test.session.owner).toBe('REPLAY');

    expect(test.session.pauseCalls).toBe(1);
  });

  it('binds evidence references to the intervention record', async () => {
    const test = fixture('DISCOVERY');

    const evidenceRef = {
      evidenceId: 'event-log-1',
      runId: 'run-1',
      kind: 'event_log' as const,
      relativePath: 'run-1/events.jsonl',
      mediaType: 'application/x-ndjson',
      capturedAt: NOW,
    };

    await test.controller.createAndPause({
      context: test.context,
      id: 'intervention-3',
      source: 'DISCOVERY',
      goal: 'Read the member savings balance',
      stepId: '5',
      reasonCode: 'AUTOMATION_STUCK',
      reason: 'Repeated application state',
      observedState: 'Member details page remained unchanged',
      evidenceRefs: [evidenceRef],
    });

    const stored = await test.manager.get('intervention-3');

    expect(stored.request.evidenceRefs).toEqual([evidenceRef]);
  });

  it('does not pause when intervention persistence fails', async () => {
    const store = new InMemoryInterventionStore();

    const manager = new InterventionManager({
      store,
      now: () => NOW,
    });

    const controller = new InterventionController(manager);

    const session = new FakeSessionManager('DISCOVERY');

    const context = coordinatedContext(session);

    await manager.create({
      id: 'duplicate-intervention',
      sessionId: session.sessionId,
      source: 'DISCOVERY',
      reasonCode: 'AUTOMATION_STUCK',
      reason: 'Existing intervention',
      observedState: 'Existing state',
    });

    await expect(
      controller.createAndPause({
        context,
        id: 'duplicate-intervention',
        source: 'DISCOVERY',
        reasonCode: 'AUTOMATION_STUCK',
        reason: 'New intervention with duplicate id',
        observedState: 'Current state',
        evidenceRefs: [],
      }),
    ).rejects.toBeDefined();

    expect(session.state).toBe('ACTIVE');

    expect(session.owner).toBe('DISCOVERY');

    expect(session.pauseCalls).toBe(0);
  });

  it.each(['HUMAN', 'NONE'] as const)(
    'rejects intervention creation when current owner is %s',
    async (owner) => {
      const test = fixture(owner);

      await expect(
        test.controller.createAndPause({
          context: test.context,
          id: `intervention-${owner.toLowerCase()}`,
          source: 'DISCOVERY',
          reasonCode: 'AUTOMATION_STUCK',
          reason: 'Automation owner is required',
          observedState: 'Current application state',
          evidenceRefs: [],
        }),
      ).rejects.toThrow(
        `Intervention handoff requires automation ownership; current owner is ${owner}`,
      );

      expect(test.session.state).toBe('ACTIVE');

      expect(test.session.pauseCalls).toBe(0);

      await expect(test.store.get(`intervention-${owner.toLowerCase()}`)).resolves.toBeUndefined();
    },
  );

  it('keeps automation ownership unchanged after pausing', async () => {
    const test = fixture('DISCOVERY');

    await test.controller.createAndPause({
      context: test.context,
      id: 'intervention-owner-check',
      source: 'DISCOVERY',
      reasonCode: 'AUTOMATION_STUCK',
      reason: 'Human handoff requested',
      observedState: 'Current application state',
      evidenceRefs: [],
    });

    expect(test.session.state).toBe('PAUSED');

    expect(test.session.owner).toBe('DISCOVERY');
  });

  it('explicitly acquires paused discovery control for HUMAN', async () => {
    const test = fixture('DISCOVERY');

    await test.controller.createAndPause({
      context: test.context,
      id: 'intervention-human-1',
      source: 'DISCOVERY',
      reasonCode: 'AUTOMATION_STUCK',
      reason: 'Human operator is required',
      observedState: 'Current application state',
      evidenceRefs: [],
    });

    const acquired = await test.controller.acquireHumanControl({
      interventionId: 'intervention-human-1',

      context: test.context,

      acquisitionId: 'acquisition-1',

      operatorId: 'operator-1',
    });

    expect(acquired.status).toBe('ACQUIRED');

    expect(test.session.state).toBe('PAUSED');

    expect(test.session.owner).toBe('HUMAN');

    expect(test.session.transferCalls).toBe(1);

    const stored = await test.manager.get('intervention-human-1');

    expect(stored.acquisition).toEqual({
      acquisitionId: 'acquisition-1',
      acquiredAt: NOW,
      operatorId: 'operator-1',
    });

    expect(stored.humanActions.map((action) => action.kind)).toContain('CONTROL_ACQUIRED');
  });

  it('explicitly acquires paused replay control for HUMAN', async () => {
    const test = fixture('REPLAY');

    await test.controller.createAndPause({
      context: test.context,
      id: 'intervention-human-2',
      source: 'REPLAY',
      reasonCode: 'HUMAN_APPROVAL_REQUIRED',
      reason: 'Final action requires human involvement',
      observedState: 'Sub-account review screen',
      evidenceRefs: [],
    });

    const acquired = await test.controller.acquireHumanControl({
      interventionId: 'intervention-human-2',

      context: test.context,

      acquisitionId: 'acquisition-2',
    });

    expect(acquired.status).toBe('ACQUIRED');

    expect(test.session.state).toBe('PAUSED');

    expect(test.session.owner).toBe('HUMAN');
  });

  it('rejects a second human acquisition for the same intervention', async () => {
    const test = fixture('DISCOVERY');

    await test.controller.createAndPause({
      context: test.context,
      id: 'intervention-exclusive',
      source: 'DISCOVERY',
      reasonCode: 'AUTOMATION_STUCK',
      reason: 'Human operator is required',
      observedState: 'Current application state',
      evidenceRefs: [],
    });

    await test.controller.acquireHumanControl({
      interventionId: 'intervention-exclusive',
      context: test.context,
      acquisitionId: 'acquisition-a',
      operatorId: 'operator-a',
    });

    await expect(
      test.controller.acquireHumanControl({
        interventionId: 'intervention-exclusive',
        context: test.context,
        acquisitionId: 'acquisition-b',
        operatorId: 'operator-b',
      }),
    ).rejects.toBeDefined();

    const stored = await test.manager.get('intervention-exclusive');

    expect(stored.acquisition?.acquisitionId).toBe('acquisition-a');

    expect(test.session.owner).toBe('HUMAN');

    expect(test.session.transferCalls).toBe(1);
  });

  it('rejects human acquisition when the intervention belongs to another session', async () => {
    const test = fixture('DISCOVERY');

    await test.manager.create({
      id: 'foreign-intervention',
      sessionId: 'different-session',
      source: 'DISCOVERY',
      reasonCode: 'AUTOMATION_STUCK',
      reason: 'Human intervention required',
      observedState: 'Current application state',
    });

    await test.manager.transition('foreign-intervention', 'WAITING_FOR_HUMAN');

    test.session.state = 'PAUSED';

    await expect(
      test.controller.acquireHumanControl({
        interventionId: 'foreign-intervention',
        context: test.context,
        acquisitionId: 'acquisition-foreign',
      }),
    ).rejects.toThrow('is bound to another session');

    expect(test.session.owner).toBe('DISCOVERY');

    expect(test.session.transferCalls).toBe(0);
  });
});
