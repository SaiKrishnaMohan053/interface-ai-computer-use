import { describe, expect, it } from 'vitest';

import { parseOperatorCommand, toOperatorInterventionView } from '../../src/intervention/index.js';

describe('operator control contracts', () => {
  it('parses supported operator commands', () => {
    expect(
      parseOperatorCommand({
        kind: 'list',
      }),
    ).toEqual({
      kind: 'list',
    });

    expect(
      parseOperatorCommand({
        kind: 'show',
        interventionId: 'intervention-1',
      }),
    ).toMatchObject({
      kind: 'show',
      interventionId: 'intervention-1',
    });

    expect(
      parseOperatorCommand({
        kind: 'acquire',
        interventionId: 'intervention-1',
        acquisitionId: 'acquisition-1',
        operatorId: 'operator-1',
      }),
    ).toMatchObject({
      kind: 'acquire',
      acquisitionId: 'acquisition-1',
    });

    expect(
      parseOperatorCommand({
        kind: 'start',
        interventionId: 'intervention-1',
      }),
    ).toMatchObject({
      kind: 'start',
    });
  });

  it('rejects unknown operator commands', () => {
    expect(() =>
      parseOperatorCommand({
        kind: 'delete',
      }),
    ).toThrow();
  });

  it('projects only operator-safe intervention fields', () => {
    const view = toOperatorInterventionView({
      request: {
        id: 'intervention-1',
        sessionId: 'session-1',
        source: 'DISCOVERY',
        goal: 'Read savings balance',
        reasonCode: 'AUTOMATION_STUCK',
        reason: 'Automation cannot continue safely',
        observedState: 'Member details page',
        evidenceRefs: [],
        createdAt: '2026-09-21T22:00:00.000Z',
        status: 'WAITING_FOR_HUMAN',
      },
    });

    expect(view).toEqual({
      id: 'intervention-1',
      status: 'WAITING_FOR_HUMAN',
      source: 'DISCOVERY',
      reasonCode: 'AUTOMATION_STUCK',
      reason: 'Automation cannot continue safely',
      goal: 'Read savings balance',
      observedState: 'Member details page',
      evidenceRefs: [],
    });

    expect('sessionId' in view).toBe(false);

    expect('createdAt' in view).toBe(false);

    expect('context' in view).toBe(false);

    expect('page' in view).toBe(false);

    expect('browser' in view).toBe(false);
  });
});
