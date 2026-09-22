import { describe, expect, it } from 'vitest';

import {
  InMemoryInterventionStore,
  InterventionController,
  InterventionManager,
  LiveInterventionRegistry,
} from '../../src/intervention/index.js';

import type { CoordinatedRunContext } from '../../src/runtime/index.js';
import type { SessionManager } from '../../src/session/index.js';

class FakeSessionManager {
  readonly sessionId = 'session-resume-abort';

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
  mode: 'DISCOVERY' | 'REPLAY' = 'DISCOVERY',
): CoordinatedRunContext<unknown> {
  return {
    runId: 'run-resume-abort',
    mode,
    sessionManager: session as unknown as SessionManager,
  } as unknown as CoordinatedRunContext<unknown>;
}

async function acquiredFixture(source: 'DISCOVERY' | 'REPLAY' = 'DISCOVERY') {
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

  await controller.createAndPause({
    id: `intervention-${source.toLowerCase()}`,

    context: liveContext,

    source,

    reasonCode: 'HUMAN_APPROVAL_REQUIRED',

    reason: 'Human action required',

    observedState: 'Review screen',

    evidenceRefs: [],
  });

  await controller.acquireHumanControl({
    interventionId: `intervention-${source.toLowerCase()}`,

    context: liveContext,

    acquisitionId: `acquisition-${source.toLowerCase()}`,

    operatorId: 'operator-1',
  });

  await controller.markHumanWorkInProgress(`intervention-${source.toLowerCase()}`);

  return {
    manager,
    registry,
    controller,
    session,
    liveContext,
    interventionId: `intervention-${source.toLowerCase()}`,
  };
}

describe('resume and abort human handoff audit', () => {
  it('restores DISCOVERY ownership and activates the same session on resume', async () => {
    const fixture = await acquiredFixture('DISCOVERY');

    const result = await fixture.controller.resumeAutomation({
      interventionId: fixture.interventionId,

      context: fixture.liveContext,

      operatorId: 'operator-1',
    });

    expect(result.status).toBe('RESOLVED');

    expect(fixture.session.owner).toBe('DISCOVERY');

    expect(fixture.session.state).toBe('ACTIVE');

    expect(fixture.registry.has(fixture.interventionId)).toBe(false);

    const stored = await fixture.manager.get(fixture.interventionId);

    expect(stored.auditTrail.map((event) => event.type)).toEqual([
      'intervention.created',
      'human.acquire_requested',
      'human.control_acquired',
      'human.resume_requested',
      'human.control_released',
      'automation.control_restored',
    ]);

    expect(fixture.session.closeCalls).toBe(0);
  });

  it('restores REPLAY ownership on resume', async () => {
    const fixture = await acquiredFixture('REPLAY');

    await fixture.controller.resumeAutomation({
      interventionId: fixture.interventionId,

      context: fixture.liveContext,
    });

    expect(fixture.session.owner).toBe('REPLAY');

    expect(fixture.session.state).toBe('ACTIVE');
  });

  it('aborts terminally without restoring automation control', async () => {
    const fixture = await acquiredFixture('REPLAY');

    const result = await fixture.controller.abortHumanIntervention({
      interventionId: fixture.interventionId,

      context: fixture.liveContext,

      operatorId: 'operator-1',
    });

    expect(result.status).toBe('ABORTED');

    expect(fixture.session.state).toBe('PAUSED');

    expect(fixture.session.owner).toBe('NONE');

    expect(fixture.session.closeCalls).toBe(0);

    expect(fixture.registry.has(fixture.interventionId)).toBe(true);

    const stored = await fixture.manager.get(fixture.interventionId);

    expect(stored.auditTrail.map((event) => event.type)).toEqual([
      'intervention.created',
      'human.acquire_requested',
      'human.control_acquired',
      'human.abort_requested',
      'human.control_released',
    ]);

    expect(stored.auditTrail.some((event) => event.type === 'automation.control_restored')).toBe(
      false,
    );
  });

  it('rejects resume unless HUMAN owns a paused acquired intervention', async () => {
    const fixture = await acquiredFixture();

    fixture.session.owner = 'DISCOVERY';

    await expect(
      fixture.controller.resumeAutomation({
        interventionId: fixture.interventionId,

        context: fixture.liveContext,
      }),
    ).rejects.toThrow('requires HUMAN ownership');

    const stored = await fixture.manager.get(fixture.interventionId);

    expect(stored.request.status).toBe('IN_PROGRESS');

    expect(stored.auditTrail.some((event) => event.type === 'human.resume_requested')).toBe(false);
  });
});
