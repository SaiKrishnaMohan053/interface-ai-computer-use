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

class FakeSessionManager {
  readonly sessionId = 'session-manual-audit';

  state: 'ACTIVE' | 'PAUSED' = 'ACTIVE';

  owner: 'DISCOVERY' | 'REPLAY' | 'HUMAN' | 'NONE' = 'DISCOVERY';

  pause(owner: 'DISCOVERY' | 'REPLAY' | 'HUMAN' | 'NONE'): void {
    if (this.state !== 'ACTIVE' || this.owner !== owner) {
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
    runId: 'run-manual-audit',
    mode: 'DISCOVERY',
    sessionManager: session as unknown as SessionManager,
  } as unknown as CoordinatedRunContext<unknown>;
}

describe('operator manual action audit', () => {
  let server: OperatorControlServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('records a reviewer-visible human.action_performed event through the operator API', async () => {
    let auditId = 0;

    const manager = new InterventionManager({
      store: new InMemoryInterventionStore(),

      auditEventId: () => `audit-${++auditId}`,
    });

    const registry = new LiveInterventionRegistry();

    const controller = new InterventionController(manager, registry);

    const session = new FakeSessionManager();

    await controller.createAndPause({
      id: 'intervention-manual',
      context: context(session),
      source: 'DISCOVERY',
      reasonCode: 'HUMAN_APPROVAL_REQUIRED',
      reason: 'Final action requires human',
      observedState: 'Review screen',
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

    const acquire = await fetch(`${address.baseUrl}/interventions/intervention-manual/acquire`, {
      method: 'POST',

      headers: {
        'content-type': 'application/json',
      },

      body: JSON.stringify({
        acquisitionId: 'acquisition-manual',
        operatorId: 'operator-manual',
      }),
    });

    expect(acquire.status).toBe(200);

    const start = await fetch(`${address.baseUrl}/interventions/intervention-manual/start`, {
      method: 'POST',
    });

    expect(start.status).toBe(200);

    const action = await fetch(
      `${address.baseUrl}/interventions/intervention-manual/manual-action`,
      {
        method: 'POST',

        headers: {
          'content-type': 'application/json',
        },

        body: JSON.stringify({
          operatorId: 'operator-manual',
          summary: 'Reviewed final account details and performed the required manual step',
        }),
      },
    );

    expect(action.status).toBe(200);

    const body = (await action.json()) as {
      auditTrail: Array<{
        type: string;
        actor: string;
        summary: string;
      }>;
    };

    expect(body.auditTrail.map((event) => event.type)).toEqual([
      'intervention.created',
      'human.acquire_requested',
      'human.control_acquired',
      'human.action_performed',
    ]);

    expect(body.auditTrail.at(-1)).toMatchObject({
      actor: 'HUMAN',
      summary: 'Reviewed final account details and performed the required manual step',
    });

    const show = await fetch(`${address.baseUrl}/interventions/intervention-manual`);

    const shown = (await show.json()) as {
      auditTrail: Array<{
        type: string;
      }>;
    };

    expect(shown.auditTrail.at(-1)?.type).toBe('human.action_performed');
  });

  it('rejects manual action unless HUMAN owns the paused session', async () => {
    const manager = new InterventionManager({
      store: new InMemoryInterventionStore(),
    });

    const registry = new LiveInterventionRegistry();

    const controller = new InterventionController(manager, registry);

    const session = new FakeSessionManager();

    await controller.createAndPause({
      id: 'intervention-no-human',
      context: context(session),
      source: 'DISCOVERY',
      reasonCode: 'AUTOMATION_STUCK',
      reason: 'Needs human',
      observedState: 'Blocked',
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

    const response = await fetch(
      `${address.baseUrl}/interventions/intervention-no-human/manual-action`,
      {
        method: 'POST',

        headers: {
          'content-type': 'application/json',
        },

        body: JSON.stringify({
          summary: 'Should not be accepted',
        }),
      },
    );

    expect(response.status).toBe(409);
  });
});
