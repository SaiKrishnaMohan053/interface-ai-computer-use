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
  });

  it('fails explicitly when an intervention does not exist', async () => {
    const manager = createManager();

    await expect(manager.get('missing-intervention')).rejects.toBeInstanceOf(
      InterventionNotFoundError,
    );
  });

  it('transitions through valid states', async () => {
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

    await expect(manager.transition('intervention-1', 'ACQUIRED')).resolves.toMatchObject({
      status: 'ACQUIRED',
    });

    await expect(manager.transition('intervention-1', 'IN_PROGRESS')).resolves.toMatchObject({
      status: 'IN_PROGRESS',
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

  it('records human actions for the same session', async () => {
    const manager = createManager();

    await manager.create({
      id: 'intervention-1',

      sessionId: 'session-1',

      source: 'REPLAY',

      reasonCode: 'HUMAN_APPROVAL_REQUIRED',

      reason: 'Human action required',

      observedState: 'Review page',
    });

    await manager.transition('intervention-1', 'WAITING_FOR_HUMAN');

    await manager.transition('intervention-1', 'ACQUIRED');

    await manager.recordHumanAction({
      actionId: 'human-action-1',

      interventionId: 'intervention-1',

      sessionId: 'session-1',

      kind: 'CONTROL_ACQUIRED',

      summary: 'Human acquired control',

      occurredAt: NOW,

      evidenceRefs: [],

      details: {},
    });

    const stored = await manager.get('intervention-1');

    expect(stored.humanActions).toHaveLength(1);
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

    await manager.create({
      id: 'intervention-1',

      sessionId: 'session-1',

      source: 'REPLAY',

      reasonCode: 'HUMAN_APPROVAL_REQUIRED',

      reason: 'Human must complete the final action',

      observedState: 'Review page',
    });

    await manager.transition('intervention-1', 'WAITING_FOR_HUMAN');

    await manager.transition('intervention-1', 'ACQUIRED');

    await manager.transition('intervention-1', 'IN_PROGRESS');

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

    await manager.create({
      id: 'intervention-1',

      sessionId: 'session-1',

      source: 'REPLAY',

      reasonCode: 'HUMAN_APPROVAL_REQUIRED',

      reason: 'Human action required',

      observedState: 'Review page',
    });

    await manager.transition('intervention-1', 'WAITING_FOR_HUMAN');

    await manager.transition('intervention-1', 'ACQUIRED');

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
