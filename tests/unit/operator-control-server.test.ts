import { afterEach, describe, expect, it } from 'vitest';

import {
  InMemoryInterventionStore,
  InterventionController,
  InterventionManager,
  LiveInterventionRegistry,
  OperatorControlServer,
} from '../../src/intervention/index.js';

import type { CoordinatedRunContext } from '../../src/runtime/index.js';
import type { SessionManager } from '../../src/session/index.js';

const NOW = '2026-09-21T23:15:00.000Z';

class FakeSessionManager {
  readonly sessionId = 'session-1';

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
      throw new Error('Invalid ownership transfer');
    }

    this.owner = to;
  }
}

function liveContext(session: FakeSessionManager): CoordinatedRunContext<unknown> {
  return {
    runId: 'run-1',

    mode: 'DISCOVERY',

    sessionManager: session as unknown as SessionManager,
  } as unknown as CoordinatedRunContext<unknown>;
}

describe('OperatorControlServer', () => {
  let server: OperatorControlServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  async function fixture() {
    const store = new InMemoryInterventionStore();

    const manager = new InterventionManager({
      store,
      now: () => NOW,
    });

    const registry = new LiveInterventionRegistry();

    const controller = new InterventionController(manager, registry);

    const session = new FakeSessionManager();

    const context = liveContext(session);

    await controller.createAndPause({
      context,

      id: 'intervention-1',

      source: 'DISCOVERY',

      goal: 'Read savings balance',

      stepId: '4',

      reasonCode: 'AUTOMATION_STUCK',

      reason: 'Automation cannot continue safely',

      observedState: 'Member details page',

      evidenceRefs: [],
    });

    server = new OperatorControlServer(
      {
        manager,
        controller,
        liveRegistry: registry,
      },
      {
        port: 0,
      },
    );

    const address = await server.start();

    return {
      manager,
      registry,
      controller,
      session,
      context,
      address,
    };
  }

  it('binds only to localhost', async () => {
    const test = await fixture();

    expect(test.address.host).toBe('127.0.0.1');

    expect(test.address.baseUrl).toBe(`http://127.0.0.1:${test.address.port}`);
  });

  it('lists only operator-safe intervention data', async () => {
    const test = await fixture();

    const response = await fetch(`${test.address.baseUrl}/interventions`);

    expect(response.status).toBe(200);

    const body = (await response.json()) as Array<Record<string, unknown>>;

    expect(body).toHaveLength(1);

    expect(body[0]).toMatchObject({
      id: 'intervention-1',
      status: 'WAITING_FOR_HUMAN',
      source: 'DISCOVERY',
      reasonCode: 'AUTOMATION_STUCK',
      goal: 'Read savings balance',
      stepId: '4',
      observedState: 'Member details page',
    });

    expect(body[0]?.sessionId).toBeUndefined();

    expect(body[0]?.context).toBeUndefined();

    expect(body[0]?.page).toBeUndefined();

    expect(body[0]?.browser).toBeUndefined();
  });

  it('shows one intervention', async () => {
    const test = await fixture();

    const response = await fetch(`${test.address.baseUrl}/interventions/intervention-1`);

    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;

    expect(body).toMatchObject({
      id: 'intervention-1',
      status: 'WAITING_FOR_HUMAN',
    });
  });

  it('acquires real live control through the registered context', async () => {
    const test = await fixture();

    const response = await fetch(`${test.address.baseUrl}/interventions/intervention-1/acquire`, {
      method: 'POST',

      headers: {
        'content-type': 'application/json',
      },

      body: JSON.stringify({
        acquisitionId: 'acquisition-1',

        operatorId: 'operator-1',
      }),
    });

    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;

    expect(body).toMatchObject({
      id: 'intervention-1',
      status: 'ACQUIRED',
      acquisition: {
        acquisitionId: 'acquisition-1',
        operatorId: 'operator-1',
      },
    });

    expect(test.session.state).toBe('PAUSED');

    expect(test.session.owner).toBe('HUMAN');
  });

  it('rejects a second acquire', async () => {
    const test = await fixture();

    const first = await fetch(`${test.address.baseUrl}/interventions/intervention-1/acquire`, {
      method: 'POST',

      headers: {
        'content-type': 'application/json',
      },

      body: JSON.stringify({
        acquisitionId: 'acquisition-a',
      }),
    });

    expect(first.status).toBe(200);

    const second = await fetch(`${test.address.baseUrl}/interventions/intervention-1/acquire`, {
      method: 'POST',

      headers: {
        'content-type': 'application/json',
      },

      body: JSON.stringify({
        acquisitionId: 'acquisition-b',
      }),
    });

    expect(second.status).toBe(409);

    const stored = await test.manager.get('intervention-1');

    expect(stored.acquisition?.acquisitionId).toBe('acquisition-a');
  });

  it('moves acquired human work to IN_PROGRESS', async () => {
    const test = await fixture();

    const acquired = await fetch(`${test.address.baseUrl}/interventions/intervention-1/acquire`, {
      method: 'POST',

      headers: {
        'content-type': 'application/json',
      },

      body: JSON.stringify({
        acquisitionId: 'acquisition-1',
      }),
    });

    expect(acquired.status).toBe(200);

    const response = await fetch(`${test.address.baseUrl}/interventions/intervention-1/start`, {
      method: 'POST',
    });

    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;

    expect(body).toMatchObject({
      id: 'intervention-1',
      status: 'IN_PROGRESS',
    });

    expect(test.session.owner).toBe('HUMAN');

    expect(test.session.state).toBe('PAUSED');
  });

  it('rejects acquire when the live intervention context is unavailable', async () => {
    const test = await fixture();

    test.registry.remove('intervention-1');

    const response = await fetch(`${test.address.baseUrl}/interventions/intervention-1/acquire`, {
      method: 'POST',
    });

    expect(response.status).toBe(409);

    const stored = await test.manager.get('intervention-1');

    expect(stored.request.status).toBe('WAITING_FOR_HUMAN');

    expect(test.session.owner).toBe('DISCOVERY');
  });
});
