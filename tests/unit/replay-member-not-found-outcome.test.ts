import { describe, expect, it, vi } from 'vitest';

import { executeReplayCheckpointFlow } from '../../src/replay/index.js';

describe('replay MEMBER_NOT_FOUND business outcome', () => {
  it('returns MEMBER_NOT_FOUND as business_outcome', async () => {
    const executeAction = vi.fn(() => Promise.resolve('must-not-execute'));

    const result = await executeReplayCheckpointFlow({
      stepId: 'search-member',

      evaluatePreconditions: () =>
        Promise.resolve({
          status: 'passed',
        }),

      detectBusinessOutcome: () =>
        Promise.resolve({
          status: 'business_outcome',

          code: 'MEMBER_NOT_FOUND',

          message: 'No member matched the supplied lookup input.',

          details: {
            detector: 'Member not found',
          },
        }),

      executeAction,

      evaluatePostconditions: () =>
        Promise.resolve({
          status: 'passed',
        }),

      evaluateSuccessCondition: () =>
        Promise.resolve({
          status: 'passed',
        }),
    });

    expect(executeAction).not.toHaveBeenCalled();

    expect(result).toEqual({
      status: 'business_outcome',

      outcome: {
        code: 'MEMBER_NOT_FOUND',

        message: 'No member matched the supplied lookup input.',

        details: {
          detector: 'Member not found',
        },
      },
    });
  });

  it('never converts MEMBER_NOT_FOUND into failure', async () => {
    const result = await executeReplayCheckpointFlow({
      stepId: 'search-member',

      evaluatePreconditions: () =>
        Promise.resolve({
          status: 'passed',
        }),

      detectBusinessOutcome: () =>
        Promise.resolve({
          status: 'business_outcome',

          code: 'MEMBER_NOT_FOUND',

          message: 'No member matched.',
        }),

      executeAction: () => Promise.resolve('unused'),

      evaluatePostconditions: () =>
        Promise.resolve({
          status: 'passed',
        }),

      evaluateSuccessCondition: () =>
        Promise.resolve({
          status: 'passed',
        }),
    });

    expect(result.status).toBe('business_outcome');

    expect(result.status).not.toBe('failure');

    if (result.status === 'business_outcome') {
      expect(result.outcome.code).toBe('MEMBER_NOT_FOUND');
    }
  });

  it('stops replay immediately after MEMBER_NOT_FOUND detection', async () => {
    const executeAction = vi.fn(() => Promise.resolve());

    const postconditions = vi.fn(() =>
      Promise.resolve({
        status: 'passed' as const,
      }),
    );

    const successCondition = vi.fn(() =>
      Promise.resolve({
        status: 'passed' as const,
      }),
    );

    await executeReplayCheckpointFlow({
      stepId: 'search-member',

      evaluatePreconditions: () =>
        Promise.resolve({
          status: 'passed',
        }),

      detectBusinessOutcome: () =>
        Promise.resolve({
          status: 'business_outcome',

          code: 'MEMBER_NOT_FOUND',

          message: 'No member matched.',
        }),

      executeAction,

      evaluatePostconditions: postconditions,

      evaluateSuccessCondition: successCondition,
    });

    expect(executeAction).not.toHaveBeenCalled();

    expect(postconditions).not.toHaveBeenCalled();

    expect(successCondition).not.toHaveBeenCalled();
  });
});
