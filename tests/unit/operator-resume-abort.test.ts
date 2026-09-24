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
  readonly sessionId = 'session-operator-resolution';

  state: 'ACTIVE' | 'PAUSED' | 'CLOSED' = 'ACTIVE';

  owner: 'DISCOVERY' | 'REPLAY' | 'HUMAN' | 'NONE' = 'DISCOVERY';

  closeCalls = 0;

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

  releaseOwnership(owner: 'DISCOVERY' | 'REPLAY' | 'HUMAN'): void {
    if (this.owner !== owner) {
      throw new Error('Invalid ownership release');
    }

    this.owner = 'NONE';
  }

  resume(requestedBy: 'DISCOVERY' | 'REPLAY' | 'HUMAN' | 'NONE'): void {
    if (
      this.state !== 'PAUSED' ||
      this.owner !== requestedBy ||
      requestedBy === 'HUMAN' ||
      requestedBy === 'NONE'
    ) {
      throw new Error('Invalid resume');
    }

    this.state = 'ACTIVE';
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    this.state = 'CLOSED';
    this.owner = 'NONE';

    return Promise.resolve();
  }
}

function context(
  session: FakeSessionManager,
  source: 'DISCOVERY' | 'REPLAY',
): CoordinatedRunContext<unknown> {
  return {
    runId: `run-${source.toLowerCase()}`,
    mode: source,
    sessionManager: session as unknown as SessionManager,
  } as unknown as CoordinatedRunContext<unknown>;
}

async function createAcquiredFixture(source: 'DISCOVERY' | 'REPLAY') {
  let auditId = 0;

  const manager = new InterventionManager({
    store: new InMemoryInterventionStore(),

    auditEventId: () => `audit-${++auditId}`,
  });

  const registry = new LiveInterventionRegistry();

  const controller = new InterventionController(manager, registry);

  const session = new FakeSessionManager();

  session.owner = source;

  const liveContext = context(session, source);

  const interventionId = `intervention-${source.toLowerCase()}`;

  await controller.createAndPause({
    id: interventionId,
    context: liveContext,
    source,
    reasonCode: 'HUMAN_APPROVAL_REQUIRED',
    reason: 'Final action requires human',
    observedState: 'Review screen',
    evidenceRefs: [],
  });

  await controller.acquireHumanControl({
    interventionId,
    context: liveContext,
    acquisitionId: `acquisition-${source.toLowerCase()}`,
    operatorId: 'operator-1',
  });

  await controller.markHumanWorkInProgress(interventionId);

  return {
    manager,
    registry,
    controller,
    session,
    interventionId,
  };
}

describe('operator resume and abort routes', () => {
  let server: OperatorControlServer | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('resumes the same live session and exposes the completed audit trail', async () => {
    const fixture = await createAcquiredFixture('REPLAY');

    server = new OperatorControlServer(
      {
        manager: fixture.manager,
        controller: fixture.controller,
        liveRegistry: fixture.registry,
      },
      {
        port: 0,
      },
    );

    const address = await server.start();

    const response = await fetch(
      `${address.baseUrl}/interventions/${fixture.interventionId}/resume`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          operatorId: 'operator-1',
        }),
      },
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      status: string;
      source: string;
      auditTrail: Array<{
        type: string;
      }>;
    };

    expect(body.status).toBe('RESOLVED');

    expect(body.source).toBe('REPLAY');

    expect(fixture.session.state).toBe('ACTIVE');

    expect(fixture.session.owner).toBe('REPLAY');

    expect(fixture.session.closeCalls).toBe(0);

    expect(body.auditTrail.map((event) => event.type)).toEqual([
      'intervention.created',
      'human.acquire_requested',
      'human.control_acquired',
      'human.resume_requested',
      'human.control_released',
      'automation.control_restored',
    ]);
  });

  it('aborts the intervention, releases HUMAN ownership, and never restores automation', async () => {
    const fixture = await createAcquiredFixture('DISCOVERY');

    server = new OperatorControlServer(
      {
        manager: fixture.manager,
        controller: fixture.controller,
        liveRegistry: fixture.registry,
      },
      {
        port: 0,
      },
    );

    const address = await server.start();

    const response = await fetch(
      `${address.baseUrl}/interventions/${fixture.interventionId}/abort`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          operatorId: 'operator-1',
        }),
      },
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      status: string;
      auditTrail: Array<{
        type: string;
      }>;
    };

    expect(body.status).toBe('ABORTED');

    expect(fixture.session.state).toBe('PAUSED');

    expect(fixture.session.owner).toBe('NONE');

    expect(fixture.session.closeCalls).toBe(0);

    expect(body.auditTrail.map((event) => event.type)).toEqual([
      'intervention.created',
      'human.acquire_requested',
      'human.control_acquired',
      'human.abort_requested',
      'human.control_released',
    ]);

    expect(body.auditTrail.some((event) => event.type === 'automation.control_restored')).toBe(
      false,
    );
  });

  it('rejects resume when HUMAN no longer owns the paused intervention', async () => {
    const fixture = await createAcquiredFixture('DISCOVERY');

    fixture.session.owner = 'DISCOVERY';

    server = new OperatorControlServer(
      {
        manager: fixture.manager,
        controller: fixture.controller,
        liveRegistry: fixture.registry,
      },
      {
        port: 0,
      },
    );

    const address = await server.start();

    const response = await fetch(
      `${address.baseUrl}/interventions/${fixture.interventionId}/resume`,
      {
        method: 'POST',
      },
    );

    expect(response.status).toBe(409);

    const stored = await fixture.manager.get(fixture.interventionId);

    expect(stored.request.status).toBe('IN_PROGRESS');

    expect(stored.auditTrail.some((event) => event.type === 'human.resume_requested')).toBe(false);
  });
});
