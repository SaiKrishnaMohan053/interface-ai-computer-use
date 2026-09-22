import { describe, expect, it } from 'vitest';

import {
  InMemoryInterventionStore,
  InterventionError,
  InterventionManager,
  InterventionNotFoundError,
} from '../../src/intervention/index.js';

const NOW = '2026-09-21T22:00:00.000Z';

function createManager() {
  return new InterventionManager({
    store: new InMemoryInterventionStore(),
    now: () => NOW,
  });
}

async function createWaitingIntervention(
  manager: InterventionManager,
  options: {
    id?: string;
    sessionId?: string;
    source?: 'DISCOVERY' | 'REPLAY';
  } = {},
) {
  const id = options.id ?? 'intervention-1';
  const sessionId = options.sessionId ?? 'session-1';
  const source = options.source ?? 'REPLAY';

  await manager.create({
    id,
    sessionId,
    source,
    reasonCode: source === 'REPLAY' ? 'HUMAN_APPROVAL_REQUIRED' : 'AUTOMATION_STUCK',
    reason: 'Human involvement is required',
    observedState: 'Review page',
  });

  await manager.transition(id, 'WAITING_FOR_HUMAN');

  return id;
}

describe('InterventionManager', () => {
  it('creates an intervention bound to a session', async () => {
    const manager = createManager();

    const intervention = await manager.create({
      id: 'intervention-1',
      sessionId: 'session-1',
      source: 'DISCOVERY',
      goal: 'Read savings balance',
      reasonCode: 'AUTOMATION_STUCK',
      reason: 'Automation cannot safely identify a unique target',
      observedState: 'Member details page',
    });

    expect(intervention).toMatchObject({
      id: 'intervention-1',
      sessionId: 'session-1',
      source: 'DISCOVERY',
      status: 'REQUESTED',
      createdAt: NOW,
    });
  });

  it('looks up an intervention', async () => {
    const manager = createManager();

    await manager.create({
      id: 'intervention-1',
      sessionId: 'session-1',
      source: 'REPLAY',
      reasonCode: 'HUMAN_APPROVAL_REQUIRED',
      reason: 'Final action requires human involvement',
      observedState: 'Review page',
    });

    const stored = await manager.get('intervention-1');

    expect(stored.request.id).toBe('intervention-1');

    expect(stored.humanActions).toEqual([]);
    expect(stored.acquisition).toBeUndefined();
  });

  it('fails explicitly when an intervention does not exist', async () => {
    const manager = createManager();

    await expect(manager.get('missing-intervention')).rejects.toBeInstanceOf(
      InterventionNotFoundError,
    );
  });

  it('transitions through valid non-acquisition states', async () => {
    const manager = createManager();

    await manager.create({
      id: 'intervention-1',
      sessionId: 'session-1',
      source: 'REPLAY',
      reasonCode: 'HUMAN_APPROVAL_REQUIRED',
      reason: 'Final action requires human involvement',
      observedState: 'Review page',
    });

    await expect(manager.transition('intervention-1', 'WAITING_FOR_HUMAN')).resolves.toMatchObject({
      status: 'WAITING_FOR_HUMAN',
    });
  });

  it('rejects invalid transitions', async () => {
    const manager = createManager();

    await manager.create({
      id: 'intervention-1',
      sessionId: 'session-1',
      source: 'DISCOVERY',
      reasonCode: 'AUTOMATION_STUCK',
      reason: 'Automation stuck',
      observedState: 'Unknown state',
    });

    await expect(manager.transition('intervention-1', 'ACQUIRED')).rejects.toMatchObject({
      code: 'INVALID_INTERVENTION_TRANSITION',
    });
  });

  it('acquires a waiting intervention exclusively', async () => {
    const manager = createManager();

    await createWaitingIntervention(manager);

    const stored = await manager.acquire({
      interventionId: 'intervention-1',
      sessionId: 'session-1',
      acquisitionId: 'acquisition-1',
      operatorId: 'operator-1',
    });

    expect(stored.request.status).toBe('ACQUIRED');

    expect(stored.acquisition).toEqual({
      acquisitionId: 'acquisition-1',
      acquiredAt: NOW,
      operatorId: 'operator-1',
    });

    expect(stored.humanActions).toEqual([
      expect.objectContaining({
        actionId: 'acquisition-1',
        interventionId: 'intervention-1',
        sessionId: 'session-1',
        kind: 'CONTROL_ACQUIRED',
        occurredAt: NOW,
      }),
    ]);
  });

  it('rejects a second acquisition of the same intervention', async () => {
    const manager = createManager();

    await createWaitingIntervention(manager);

    await manager.acquire({
      interventionId: 'intervention-1',
      sessionId: 'session-1',
      acquisitionId: 'acquisition-a',
      operatorId: 'operator-a',
    });

    await expect(
      manager.acquire({
        interventionId: 'intervention-1',
        sessionId: 'session-1',
        acquisitionId: 'acquisition-b',
        operatorId: 'operator-b',
      }),
    ).rejects.toThrow('cannot be acquired from status ACQUIRED');

    const stored = await manager.get('intervention-1');

    expect(stored.acquisition?.acquisitionId).toBe('acquisition-a');
  });

  it('rejects acquisition from another session', async () => {
    const manager = createManager();

    await createWaitingIntervention(manager);

    await expect(
      manager.acquire({
        interventionId: 'intervention-1',
        sessionId: 'different-session',
        acquisitionId: 'acquisition-1',
      }),
    ).rejects.toThrow('is bound to another session');

    const stored = await manager.get('intervention-1');

    expect(stored.request.status).toBe('WAITING_FOR_HUMAN');

    expect(stored.acquisition).toBeUndefined();
  });

  it('moves an acquired intervention to IN_PROGRESS', async () => {
    const manager = createManager();

    await createWaitingIntervention(manager);

    await manager.acquire({
      interventionId: 'intervention-1',
      sessionId: 'session-1',
      acquisitionId: 'acquisition-1',
    });

    const stored = await manager.markInProgress('intervention-1');

    expect(stored.request.status).toBe('IN_PROGRESS');

    expect(stored.acquisition?.acquisitionId).toBe('acquisition-1');
  });

  it('rejects IN_PROGRESS before acquisition', async () => {
    const manager = createManager();

    await createWaitingIntervention(manager);

    await expect(manager.markInProgress('intervention-1')).rejects.toThrow(
      'must be ACQUIRED before entering IN_PROGRESS',
    );
  });

  it('records human actions for the same session', async () => {
    const manager = createManager();

    await createWaitingIntervention(manager);

    await manager.acquire({
      interventionId: 'intervention-1',
      sessionId: 'session-1',
      acquisitionId: 'acquisition-1',
    });

    await manager.recordHumanAction({
      actionId: 'human-action-1',
      interventionId: 'intervention-1',
      sessionId: 'session-1',
      kind: 'MANUAL_STEP',
      summary: 'Human performed a step',
      occurredAt: NOW,
      evidenceRefs: [],
      details: {},
    });

    const stored = await manager.get('intervention-1');

    expect(stored.humanActions).toHaveLength(2);

    expect(stored.humanActions.map((action) => action.kind)).toEqual([
      'CONTROL_ACQUIRED',
      'MANUAL_STEP',
    ]);
  });

  it('rejects human actions from another session', async () => {
    const manager = createManager();

    await manager.create({
      id: 'intervention-1',
      sessionId: 'session-1',
      source: 'REPLAY',
      reasonCode: 'HUMAN_APPROVAL_REQUIRED',
      reason: 'Human action required',
      observedState: 'Review page',
    });

    await expect(
      manager.recordHumanAction({
        actionId: 'human-action-1',
        interventionId: 'intervention-1',
        sessionId: 'different-session',
        kind: 'MANUAL_STEP',
        summary: 'Human performed a step',
        occurredAt: NOW,
        evidenceRefs: [],
        details: {},
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_INTERVENTION',
    });
  });

  it('attaches evidence references without changing lifecycle state', async () => {
    const manager = createManager();

    await manager.create({
      id: 'intervention-1',
      sessionId: 'session-1',
      source: 'DISCOVERY',
      reasonCode: 'AUTOMATION_STUCK',
      reason: 'Automation stuck',
      observedState: 'Member details page',
    });

    const before = await manager.get('intervention-1');

    expect(before.request.status).toBe('REQUESTED');

    const after = await manager.addEvidenceReferences('intervention-1', []);

    expect(after.status).toBe('REQUESTED');
  });

  it('resolves a human intervention without performing session operations', async () => {
    const manager = createManager();

    await createWaitingIntervention(manager);

    await manager.acquire({
      interventionId: 'intervention-1',
      sessionId: 'session-1',
      acquisitionId: 'acquisition-1',
    });

    await manager.markInProgress('intervention-1');

    const result = await manager.resolve('intervention-1', {
      kind: 'RESUME',
      code: 'MANUAL_ACTION_COMPLETED',
      summary: 'Human completed the required manual action',
      resolvedAt: NOW,
      evidenceRefs: [],
    });

    expect(result.request.status).toBe('RESOLVED');

    expect(result.resolution?.kind).toBe('RESUME');
  });

  it('aborts an active intervention', async () => {
    const manager = createManager();

    await manager.create({
      id: 'intervention-1',
      sessionId: 'session-1',
      source: 'DISCOVERY',
      reasonCode: 'AUTOMATION_STUCK',
      reason: 'Automation stuck',
      observedState: 'Unknown state',
    });

    const result = await manager.abort('intervention-1', {
      kind: 'ABORT',
      code: 'HUMAN_ABORTED',
      summary: 'Human chose to abort',
      resolvedAt: NOW,
      evidenceRefs: [],
    });

    expect(result.request.status).toBe('ABORTED');

    expect(result.resolution?.kind).toBe('ABORT');
  });

  it('expires an intervention before human acquisition', async () => {
    const manager = createManager();

    await manager.create({
      id: 'intervention-1',
      sessionId: 'session-1',
      source: 'DISCOVERY',
      reasonCode: 'AUTOMATION_STUCK',
      reason: 'Automation stuck',
      observedState: 'Unknown state',
    });

    await manager.transition('intervention-1', 'WAITING_FOR_HUMAN');

    const result = await manager.expire('intervention-1');

    expect(result.status).toBe('EXPIRED');
  });

  it('does not allow mutation after terminal resolution', async () => {
    const manager = createManager();

    await createWaitingIntervention(manager);

    await manager.acquire({
      interventionId: 'intervention-1',
      sessionId: 'session-1',
      acquisitionId: 'acquisition-1',
    });

    await manager.resolve('intervention-1', {
      kind: 'RESUME',
      code: 'STATE_RESOLVED',
      summary: 'Human verified the state',
      resolvedAt: NOW,
      evidenceRefs: [],
    });

    await expect(manager.addEvidenceReferences('intervention-1', [])).rejects.toBeInstanceOf(
      InterventionError,
    );
  });
});
