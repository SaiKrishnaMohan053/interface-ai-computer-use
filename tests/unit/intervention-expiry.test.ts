import { describe, expect, it } from 'vitest';

import {
  expireInterventionIfTimedOut,
  InMemoryInterventionStore,
  InterventionManager,
} from '../../src/intervention/index.js';

const CREATED_AT = '2026-09-22T18:00:00.000Z';

function manager() {
  return new InterventionManager({
    store: new InMemoryInterventionStore(),

    now: () => CREATED_AT,
  });
}

async function waitingIntervention(interventionManager: InterventionManager, id: string) {
  await interventionManager.create({
    id,

    sessionId: 'session-expiry',

    source: 'REPLAY',

    reasonCode: 'HUMAN_APPROVAL_REQUIRED',

    reason: 'Waiting for human approval.',

    observedState: 'Review screen.',

    createdAt: CREATED_AT,
  });

  await interventionManager.transition(id, 'WAITING_FOR_HUMAN');
}

describe('intervention expiry', () => {
  it('expires a waiting intervention when the configured timeout is reached', async () => {
    const interventionManager = manager();

    await waitingIntervention(interventionManager, 'intervention-expired');

    const result = await expireInterventionIfTimedOut(interventionManager, {
      interventionId: 'intervention-expired',

      timeoutMs: 60_000,

      now: '2026-09-22T18:01:00.000Z',
    });

    expect(result).toMatchObject({
      status: 'expired',

      ageMs: 60_000,

      intervention: {
        id: 'intervention-expired',

        status: 'EXPIRED',
      },
    });

    expect((await interventionManager.get('intervention-expired')).request.status).toBe('EXPIRED');
  });

  it('keeps a waiting intervention active before the timeout', async () => {
    const interventionManager = manager();

    await waitingIntervention(interventionManager, 'intervention-waiting');

    const result = await expireInterventionIfTimedOut(interventionManager, {
      interventionId: 'intervention-waiting',

      timeoutMs: 60_000,

      now: '2026-09-22T18:00:59.999Z',
    });

    expect(result).toMatchObject({
      status: 'not_expired',

      ageMs: 59_999,

      intervention: {
        status: 'WAITING_FOR_HUMAN',
      },
    });
  });

  it('does not expire an intervention after human acquisition', async () => {
    const interventionManager = manager();

    await waitingIntervention(interventionManager, 'intervention-acquired');

    await interventionManager.acquire({
      interventionId: 'intervention-acquired',

      sessionId: 'session-expiry',

      acquisitionId: 'acquisition-1',
    });

    const result = await expireInterventionIfTimedOut(interventionManager, {
      interventionId: 'intervention-acquired',

      timeoutMs: 1,

      now: '2026-09-22T19:00:00.000Z',
    });

    expect(result).toMatchObject({
      status: 'not_applicable',

      reason: 'ALREADY_ACQUIRED',

      intervention: {
        status: 'ACQUIRED',
      },
    });
  });

  it('does not mutate an already terminal intervention', async () => {
    const interventionManager = manager();

    await waitingIntervention(interventionManager, 'intervention-terminal');

    await interventionManager.transition('intervention-terminal', 'EXPIRED');

    const result = await expireInterventionIfTimedOut(interventionManager, {
      interventionId: 'intervention-terminal',

      timeoutMs: 1,

      now: '2026-09-22T19:00:00.000Z',
    });

    expect(result).toMatchObject({
      status: 'not_applicable',

      reason: 'TERMINAL_STATUS',

      intervention: {
        status: 'EXPIRED',
      },
    });
  });

  it('rejects invalid timeout configuration', async () => {
    const interventionManager = manager();

    await waitingIntervention(interventionManager, 'intervention-invalid-timeout');

    await expect(
      expireInterventionIfTimedOut(interventionManager, {
        interventionId: 'intervention-invalid-timeout',

        timeoutMs: 0,

        now: '2026-09-22T19:00:00.000Z',
      }),
    ).rejects.toThrow('timeoutMs must be greater than zero');
  });
});
