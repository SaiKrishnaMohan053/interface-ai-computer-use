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

const NOW = '2026-09-21T23:30:00.000Z';

class FakeSessionManager {
  readonly sessionId = 'session-cli';

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

function context(session: FakeSessionManager): CoordinatedRunContext<unknown> {
  return {
    runId: 'run-cli',

    mode: 'DISCOVERY',

    sessionManager: session as unknown as SessionManager,
  } as unknown as CoordinatedRunContext<unknown>;
}

describe('operator CLI server contract', () => {
  let server: OperatorControlServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('supports the exact list/show/acquire/start sequence used by the CLI', async () => {
    const store = new InMemoryInterventionStore();

    const manager = new InterventionManager({
      store,
      now: () => NOW,
    });

    const registry = new LiveInterventionRegistry();

    const controller = new InterventionController(manager, registry);

    const session = new FakeSessionManager();

    await controller.createAndPause({
      context: context(session),

      id: 'intervention-cli-1',

      source: 'DISCOVERY',

      goal: 'Read savings balance',

      reasonCode: 'AUTOMATION_STUCK',

      reason: 'Human control required',

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

    const listResponse = await fetch(`${address.baseUrl}/interventions`);

    expect(listResponse.status).toBe(200);

    const list = (await listResponse.json()) as Array<Record<string, unknown>>;

    expect(list).toHaveLength(1);

    const showResponse = await fetch(`${address.baseUrl}/interventions/intervention-cli-1`);

    expect(showResponse.status).toBe(200);

    const acquireResponse = await fetch(
      `${address.baseUrl}/interventions/intervention-cli-1/acquire`,
      {
        method: 'POST',

        headers: {
          'content-type': 'application/json',
        },

        body: JSON.stringify({
          acquisitionId: 'cli-acquisition-1',

          operatorId: 'cli-operator',
        }),
      },
    );

    expect(acquireResponse.status).toBe(200);

    expect(session.owner).toBe('HUMAN');

    const startResponse = await fetch(`${address.baseUrl}/interventions/intervention-cli-1/start`, {
      method: 'POST',
    });

    expect(startResponse.status).toBe(200);

    const started = (await startResponse.json()) as Record<string, unknown>;

    expect(started.status).toBe('IN_PROGRESS');
  });
});
