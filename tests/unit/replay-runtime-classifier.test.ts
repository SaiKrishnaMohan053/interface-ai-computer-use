import { describe, expect, it } from 'vitest';

import { classifyReplayRuntimeSignal } from '../../src/replay/index.js';

import type { RecoverableCondition } from '../../src/runtime/index.js';

describe('replay runtime classifier', () => {
  it('classifies a business outcome as BUSINESS_OUTCOME', () => {
    const result = classifyReplayRuntimeSignal({
      kind: 'business_outcome',

      outcome: {
        code: 'MEMBER_NOT_FOUND',
        message: 'No member matched the supplied lookup input.',

        details: {
          detectorIndex: 0,
        },
      },
    });

    expect(result.category).toBe('BUSINESS_OUTCOME');

    if (result.category === 'BUSINESS_OUTCOME') {
      expect(result.outcome.code).toBe('MEMBER_NOT_FOUND');
    }
  });

  it('classifies TRANSIENT_LOAD as RECOVERABLE', () => {
    const condition: RecoverableCondition = {
      code: 'TRANSIENT_LOAD',
      message: 'The application is still loading.',
      detectedAt: '2026-09-20T20:00:00.000Z',

      details: {
        stepId: 'submit-member-search',
      },

      recovery: 'wait-and-retry',
      attempt: 1,
      maxAttempts: 2,
    };

    const result = classifyReplayRuntimeSignal({
      kind: 'recoverable',
      condition,
    });

    expect(result.category).toBe('RECOVERABLE');

    if (result.category === 'RECOVERABLE') {
      expect(result.condition).toEqual(condition);
    }
  });

  it('classifies HUMAN_APPROVAL_REQUIRED as INTERVENTION_REQUIRED', () => {
    const result = classifyReplayRuntimeSignal({
      kind: 'intervention_required',
      code: 'HUMAN_APPROVAL_REQUIRED',
      message: 'Policy requires human approval.',

      details: {
        stepId: 'sensitive-step',
      },
    });

    expect(result.category).toBe('INTERVENTION_REQUIRED');

    if (result.category === 'INTERVENTION_REQUIRED') {
      expect(result.intervention.code).toBe('HUMAN_APPROVAL_REQUIRED');

      expect(result.intervention.message).toBe('Policy requires human approval.');
    }
  });

  it('classifies APPLICATION_ERROR as HARD_FAILURE', () => {
    const result = classifyReplayRuntimeSignal({
      kind: 'failure',
      code: 'APPLICATION_ERROR',
      message: 'The application returned an error state.',
      expected: 'usable application surface',
      observed: 'application error',

      details: {
        route: '/member-search',
      },
    });

    expect(result.category).toBe('HARD_FAILURE');

    if (result.category === 'HARD_FAILURE') {
      expect(result.failure.code).toBe('APPLICATION_ERROR');

      expect(result.failure.message).toBe('The application returned an error state.');
    }
  });

  it('classifies an empty runtime signal as NONE', () => {
    const result = classifyReplayRuntimeSignal({
      kind: 'none',
    });

    expect(result).toEqual({
      category: 'NONE',
    });
  });

  it('preserves business outcome code, message, and details exactly', () => {
    const outcome = {
      code: 'PERMISSION_DENIED' as const,
      message: 'The current user cannot access this member.',

      details: {
        source: 'artifact-business-outcome-detector',
        detectorIndex: 1,
      },
    };

    const result = classifyReplayRuntimeSignal({
      kind: 'business_outcome',
      outcome,
    });

    expect(result).toEqual({
      category: 'BUSINESS_OUTCOME',
      outcome,
    });
  });

  it('preserves recoverable condition data exactly', () => {
    const condition: RecoverableCondition = {
      code: 'TRANSIENT_LOAD',

      message: 'The surface is still transitioning.',

      detectedAt: '2026-09-20T20:00:00.000Z',

      details: {
        stepId: 'submit-member-search',
        phase: 'postcondition',
      },

      recovery: 'wait-and-retry',
      attempt: 2,
      maxAttempts: 3,
    };

    const result = classifyReplayRuntimeSignal({
      kind: 'recoverable',
      condition,
    });

    expect(result).toEqual({
      category: 'RECOVERABLE',
      condition,
    });
  });

  it('preserves intervention message, code, and details exactly', () => {
    const details = {
      stepId: 'approve-transfer',
      policyId: 'runtime-policy',
    };

    const result = classifyReplayRuntimeSignal({
      kind: 'intervention_required',
      code: 'HUMAN_APPROVAL_REQUIRED',
      message: 'Human approval is required.',
      details,
    });

    expect(result).toEqual({
      category: 'INTERVENTION_REQUIRED',

      intervention: {
        code: 'HUMAN_APPROVAL_REQUIRED',
        message: 'Human approval is required.',
        details,
      },
    });
  });

  it('preserves hard failure code, message, expected, observed, and details exactly', () => {
    const details = {
      stepId: 'open-accounts',
      phase: 'execution',
    };

    const result = classifyReplayRuntimeSignal({
      kind: 'failure',

      code: 'APPLICATION_ERROR',

      message: 'Application error encountered.',

      expected: 'Accounts page',
      observed: 'Application error page',

      details,
    });

    expect(result).toEqual({
      category: 'HARD_FAILURE',

      failure: {
        code: 'APPLICATION_ERROR',
        message: 'Application error encountered.',
        expected: 'Accounts page',
        observed: 'Application error page',
        details,
      },
    });
  });

  it('uses an empty details object when intervention details are omitted', () => {
    const result = classifyReplayRuntimeSignal({
      kind: 'intervention_required',
      code: 'AUTOMATION_STUCK',
      message: 'Replay cannot continue safely.',
    });

    expect(result.category).toBe('INTERVENTION_REQUIRED');

    if (result.category === 'INTERVENTION_REQUIRED') {
      expect(result.intervention.details).toEqual({});
    }
  });

  it('uses an empty details object when failure details are omitted', () => {
    const result = classifyReplayRuntimeSignal({
      kind: 'failure',
      code: 'APPLICATION_ERROR',
      message: 'Application unavailable.',
      expected: 'usable application',
      observed: 'application error',
    });

    expect(result.category).toBe('HARD_FAILURE');

    if (result.category === 'HARD_FAILURE') {
      expect(result.failure.details).toEqual({});
    }
  });
});
