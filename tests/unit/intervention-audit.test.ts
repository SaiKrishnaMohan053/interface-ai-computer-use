import { describe, expect, it } from 'vitest';

import {
  INTERVENTION_AUDIT_EVENT_TYPES,
  isHumanAuditEvent,
  parseInterventionAuditEvent,
} from '../../src/intervention/index.js';

describe('intervention audit contracts', () => {
  it('defines the complete reviewer-facing HITL lifecycle event vocabulary', () => {
    expect(INTERVENTION_AUDIT_EVENT_TYPES).toEqual([
      'intervention.created',
      'human.acquire_requested',
      'human.control_acquired',
      'human.action_performed',
      'human.manual_step_confirmed',
      'human.resume_requested',
      'human.abort_requested',
      'human.control_released',
      'automation.control_restored',
    ]);
  });

  it('parses a semantic human control event without raw interaction data', () => {
    const event = parseInterventionAuditEvent({
      eventId: 'audit-1',
      interventionId: 'intervention-1',
      sessionId: 'session-1',
      type: 'human.control_acquired',
      actor: 'HUMAN',
      occurredAt: '2026-09-22T04:00:00.000Z',
      summary: 'Operator acquired the paused live session',
      source: 'DISCOVERY',
      operatorId: 'operator-1',
      evidenceRefs: ['evidence-1'],
    });

    expect(event.type).toBe('human.control_acquired');

    expect(isHumanAuditEvent(event)).toBe(true);

    expect(event).not.toHaveProperty('x');

    expect(event).not.toHaveProperty('y');

    expect(event).not.toHaveProperty('keystrokes');

    expect(event).not.toHaveProperty('page');

    expect(event).not.toHaveProperty('context');
  });

  it('rejects unknown lifecycle events', () => {
    expect(() =>
      parseInterventionAuditEvent({
        eventId: 'audit-2',
        interventionId: 'intervention-1',
        sessionId: 'session-1',
        type: 'human.mouse_moved',
        actor: 'HUMAN',
        occurredAt: '2026-09-22T04:00:00.000Z',
        summary: 'Raw mouse movement',
        evidenceRefs: [],
      }),
    ).toThrow();
  });

  it('rejects extra raw-control fields', () => {
    expect(() =>
      parseInterventionAuditEvent({
        eventId: 'audit-3',
        interventionId: 'intervention-1',
        sessionId: 'session-1',
        type: 'human.action_performed',
        actor: 'HUMAN',
        occurredAt: '2026-09-22T04:00:00.000Z',
        summary: 'Operator completed the manual review action',
        evidenceRefs: [],
        coordinates: {
          x: 100,
          y: 200,
        },
      }),
    ).toThrow();
  });

  it('recognizes automation restoration separately from human events', () => {
    const event = parseInterventionAuditEvent({
      eventId: 'audit-4',
      interventionId: 'intervention-1',
      sessionId: 'session-1',
      type: 'automation.control_restored',
      actor: 'AUTOMATION',
      occurredAt: '2026-09-22T04:00:00.000Z',
      summary: 'Replay control restored after human handoff',
      source: 'REPLAY',
      evidenceRefs: [],
    });

    expect(isHumanAuditEvent(event)).toBe(false);
  });
});
