import { describe, expect, it, vi } from 'vitest';

import { executeReplayCheckpointFlow } from '../../src/replay/index.js';

describe('replay condition flow', () => {
  it('continues when precondition passes', async () => {
    const executeAction = vi.fn(() => Promise.resolve('done'));

    const result = await executeReplayCheckpointFlow({
      stepId: 'open-accounts',

      evaluatePreconditions: () =>
        Promise.resolve({
          status: 'passed',
        }),

      detectBusinessOutcome: () =>
        Promise.resolve({
          status: 'none',
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

    expect(executeAction).toHaveBeenCalledTimes(1);

    expect(result).toEqual({
      status: 'success',
      actionResult: 'done',
    });
  });

  it('fails before action when precondition fails', async () => {
    const executeAction = vi.fn(() => Promise.resolve('never'));

    const result = await executeReplayCheckpointFlow({
      stepId: 'read-savings-balance',

      evaluatePreconditions: () =>
        Promise.resolve({
          status: 'failed',

          message: 'Accounts table is not visible.',

          expected: 'visible',

          observed: 'absent',
        }),

      detectBusinessOutcome: () =>
        Promise.resolve({
          status: 'none',
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
      status: 'failure',

      error: {
        code: 'CHECKPOINT_FAILED',

        phase: 'precondition',

        message: 'Accounts table is not visible.',

        expected: 'visible',

        observed: 'absent',
      },
    });
  });

  it('continues when postcondition passes', async () => {
    const result = await executeReplayCheckpointFlow({
      stepId: 'search-member',

      evaluatePreconditions: () =>
        Promise.resolve({
          status: 'passed',
        }),

      detectBusinessOutcome: () =>
        Promise.resolve({
          status: 'none',
        }),

      executeAction: () => Promise.resolve('searched'),

      evaluatePostconditions: () =>
        Promise.resolve({
          status: 'passed',
        }),

      evaluateSuccessCondition: () =>
        Promise.resolve({
          status: 'passed',
        }),
    });

    expect(result).toEqual({
      status: 'success',

      actionResult: 'searched',
    });
  });

  it('fails after action when postcondition fails', async () => {
    const successCondition = vi.fn(() =>
      Promise.resolve({
        status: 'passed' as const,
      }),
    );

    const result = await executeReplayCheckpointFlow({
      stepId: 'search-member',

      evaluatePreconditions: () =>
        Promise.resolve({
          status: 'passed',
        }),

      detectBusinessOutcome: () =>
        Promise.resolve({
          status: 'none',
        }),

      executeAction: () => Promise.resolve('searched'),

      evaluatePostconditions: () =>
        Promise.resolve({
          status: 'failed',

          message: 'Member details did not appear.',

          expected: 'Member Details',

          observed: null,
        }),

      evaluateSuccessCondition: successCondition,
    });

    expect(result).toEqual({
      status: 'failure',

      error: {
        code: 'CHECKPOINT_FAILED',

        phase: 'postcondition',

        message: 'Member details did not appear.',

        expected: 'Member Details',

        observed: null,
      },
    });

    expect(successCondition).not.toHaveBeenCalled();
  });

  it('returns success when final success condition passes', async () => {
    const result = await executeReplayCheckpointFlow({
      stepId: 'read-savings-balance',

      evaluatePreconditions: () =>
        Promise.resolve({
          status: 'passed',
        }),

      detectBusinessOutcome: () =>
        Promise.resolve({
          status: 'none',
        }),

      executeAction: () =>
        Promise.resolve({
          savingsBalance: '$12,840.50',
        }),

      evaluatePostconditions: () =>
        Promise.resolve({
          status: 'passed',
        }),

      evaluateSuccessCondition: () =>
        Promise.resolve({
          status: 'passed',
        }),
    });

    expect(result.status).toBe('success');
  });

  it('does not return success when final success condition fails', async () => {
    const result = await executeReplayCheckpointFlow({
      stepId: 'read-savings-balance',

      evaluatePreconditions: () =>
        Promise.resolve({
          status: 'passed',
        }),

      detectBusinessOutcome: () =>
        Promise.resolve({
          status: 'none',
        }),

      executeAction: () =>
        Promise.resolve({
          savingsBalance: '$12,840.50',
        }),

      evaluatePostconditions: () =>
        Promise.resolve({
          status: 'passed',
        }),

      evaluateSuccessCondition: () =>
        Promise.resolve({
          status: 'failed',

          message: 'Final replay success condition was not met.',

          expected: 'Savings balance cell and savingsBalance output',

          observed: 'output only',
        }),
    });

    expect(result).toEqual({
      status: 'failure',

      error: {
        code: 'CHECKPOINT_FAILED',

        phase: 'success_condition',

        message: 'Final replay success condition was not met.',

        expected: 'Savings balance cell and savingsBalance output',

        observed: 'output only',
      },
    });
  });
});
