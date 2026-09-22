import { describe, expect, it } from 'vitest';

import {
  InterventionError,
  allowedInterventionTransitions,
  assertInterventionTransition,
  canTransitionIntervention,
  isTerminalInterventionStatus,
} from '../../src/intervention/index.js';

describe('intervention state machine', () => {
  it('supports the normal human handoff lifecycle', () => {
    expect(canTransitionIntervention('REQUESTED', 'WAITING_FOR_HUMAN')).toBe(true);

    expect(canTransitionIntervention('WAITING_FOR_HUMAN', 'ACQUIRED')).toBe(true);

    expect(canTransitionIntervention('ACQUIRED', 'IN_PROGRESS')).toBe(true);

    expect(canTransitionIntervention('IN_PROGRESS', 'RESOLVED')).toBe(true);
  });

  it('allows resolution directly after acquisition when no manual browser step is required', () => {
    expect(canTransitionIntervention('ACQUIRED', 'RESOLVED')).toBe(true);
  });

  it('supports abort from non-terminal human workflow states', () => {
    expect(canTransitionIntervention('REQUESTED', 'ABORTED')).toBe(true);

    expect(canTransitionIntervention('WAITING_FOR_HUMAN', 'ABORTED')).toBe(true);

    expect(canTransitionIntervention('ACQUIRED', 'ABORTED')).toBe(true);

    expect(canTransitionIntervention('IN_PROGRESS', 'ABORTED')).toBe(true);
  });

  it('supports expiry only before human acquisition', () => {
    expect(canTransitionIntervention('REQUESTED', 'EXPIRED')).toBe(true);

    expect(canTransitionIntervention('WAITING_FOR_HUMAN', 'EXPIRED')).toBe(true);

    expect(canTransitionIntervention('ACQUIRED', 'EXPIRED')).toBe(false);

    expect(canTransitionIntervention('IN_PROGRESS', 'EXPIRED')).toBe(false);
  });

  it('rejects skipping directly from REQUESTED to ACQUIRED', () => {
    expect(() => assertInterventionTransition('REQUESTED', 'ACQUIRED')).toThrowError(
      expect.objectContaining({
        code: 'INVALID_INTERVENTION_TRANSITION',
      }),
    );
  });

  it('rejects returning to an earlier state', () => {
    expect(() => assertInterventionTransition('IN_PROGRESS', 'WAITING_FOR_HUMAN')).toThrowError(
      expect.objectContaining({
        code: 'INVALID_INTERVENTION_TRANSITION',
      }),
    );
  });

  it.each(['RESOLVED', 'ABORTED', 'EXPIRED'] as const)('treats %s as terminal', (status) => {
    expect(isTerminalInterventionStatus(status)).toBe(true);

    expect(allowedInterventionTransitions(status)).toEqual([]);

    expect(() => assertInterventionTransition(status, 'WAITING_FOR_HUMAN')).toThrowError(
      InterventionError,
    );
  });

  it('does not classify active states as terminal', () => {
    expect(isTerminalInterventionStatus('REQUESTED')).toBe(false);

    expect(isTerminalInterventionStatus('IN_PROGRESS')).toBe(false);
  });
});
