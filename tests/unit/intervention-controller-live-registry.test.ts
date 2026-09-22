import { describe, expect, it } from 'vitest';

import {
  InMemoryInterventionStore,
  InterventionController,
  InterventionManager,
  LiveInterventionRegistry,
} from '../../src/intervention/index.js';

import type { CoordinatedRunContext } from '../../src/runtime/index.js';
import type { SessionManager } from '../../src/session/index.js';

const NOW = '2026-09-21T23:05:00.000Z';

class FakeSessionManager {
  readonly sessionId = 'session-1';

  state: 'ACTIVE' | 'PAUSED' = 'ACTIVE';

  owner: 'DISCOVERY' | 'REPLAY' | 'HUMAN' | 'NONE' = 'DISCOVERY';

  pause(requestedBy: 'DISCOVERY' | 'REPLAY' | 'HUMAN' | 'NONE'): void {
    if (this.state !== 'ACTIVE') {
      throw new Error(`Expected ACTIVE session, received ${this.state}`);
    }

    if (this.owner !== requestedBy) {
      throw new Error(`Expected owner ${requestedBy}, received ${this.owner}`);
    }

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

    this.owner = to;
  }
}

function context(session: FakeSessionManager): CoordinatedRunContext<unknown> {
  return {
    runId: 'run-1',

    mode: 'DISCOVERY',

    sessionManager: session as unknown as SessionManager,
  } as unknown as CoordinatedRunContext<unknown>;
}

describe('InterventionController live registry wiring', () => {
  it('registers the same live context after creating and pausing an intervention', async () => {
    const store = new InMemoryInterventionStore();

    const manager = new InterventionManager({
      store,
      now: () => NOW,
    });

    const registry = new LiveInterventionRegistry();

    const controller = new InterventionController(manager, registry);

    const session = new FakeSessionManager();

    const liveContext = context(session);

    const intervention = await controller.createAndPause({
      context: liveContext,

      id: 'intervention-1',

      source: 'DISCOVERY',

      goal: 'Read savings balance',

      reasonCode: 'AUTOMATION_STUCK',

      reason: 'Automation cannot continue safely',

      observedState: 'Member details page',

      evidenceRefs: [],
    });

    expect(intervention.status).toBe('WAITING_FOR_HUMAN');

    expect(session.state).toBe('PAUSED');

    expect(session.owner).toBe('DISCOVERY');

    expect(registry.has('intervention-1')).toBe(true);

    expect(registry.get('intervention-1')).toBe(liveContext);
  });

  it('does not register a live context when intervention persistence fails', async () => {
    const store = new InMemoryInterventionStore();

    const manager = new InterventionManager({
      store,
      now: () => NOW,
    });

    const registry = new LiveInterventionRegistry();

    const controller = new InterventionController(manager, registry);

    const session = new FakeSessionManager();

    const liveContext = context(session);

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
        context: liveContext,

        id: 'duplicate-intervention',

        source: 'DISCOVERY',

        reasonCode: 'AUTOMATION_STUCK',

        reason: 'Duplicate request',

        observedState: 'Current state',

        evidenceRefs: [],
      }),
    ).rejects.toBeDefined();

    expect(registry.has('duplicate-intervention')).toBe(false);

    expect(session.state).toBe('ACTIVE');
  });

  it('keeps existing behavior when no live registry is configured', async () => {
    const store = new InMemoryInterventionStore();

    const manager = new InterventionManager({
      store,
      now: () => NOW,
    });

    const controller = new InterventionController(manager);

    const session = new FakeSessionManager();

    const intervention = await controller.createAndPause({
      context: context(session),

      id: 'intervention-no-registry',

      source: 'DISCOVERY',

      reasonCode: 'AUTOMATION_STUCK',

      reason: 'Human intervention required',

      observedState: 'Current state',

      evidenceRefs: [],
    });

    expect(intervention.status).toBe('WAITING_FOR_HUMAN');

    expect(session.state).toBe('PAUSED');
  });
});
