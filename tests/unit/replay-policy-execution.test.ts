import { describe, expect, it, vi } from 'vitest';

import { executePolicyAuthorizedReplayAction } from '../../src/replay/index.js';

describe('replay policy execution boundary', () => {
  it('executes the surface action when policy returns ALLOW', async () => {
    const executeAction = vi.fn(() =>
      Promise.resolve({
        actionStatus: 'completed',
      }),
    );

    const result = await executePolicyAuthorizedReplayAction({
      stepId: 'open-accounts',

      decision: {
        decision: 'ALLOW',

        riskLevel: 'READ_ONLY',
      },

      executeAction,
    });

    expect(executeAction).toHaveBeenCalledTimes(1);

    expect(result).toEqual({
      status: 'executed',

      result: {
        actionStatus: 'completed',
      },
    });
  });

  it('does not execute a surface action when policy returns DENY', async () => {
    const executeAction = vi.fn(() =>
      Promise.resolve({
        actionStatus: 'should-not-run',
      }),
    );

    const result = await executePolicyAuthorizedReplayAction({
      stepId: 'open-accounts',

      decision: {
        decision: 'DENY',

        code: 'POLICY_DENIED',

        riskLevel: 'READ_ONLY',
      },

      executeAction,
    });

    expect(executeAction).not.toHaveBeenCalled();

    expect(result).toEqual({
      status: 'failure',

      error: {
        code: 'POLICY_DENIED',

        message: 'Replay action was denied by runtime policy.',

        details: {
          stepId: 'open-accounts',

          riskLevel: 'READ_ONLY',

          policyDecision: 'DENY',
        },
      },
    });
  });

  it('does not execute a surface action when policy requires a human', async () => {
    const executeAction = vi.fn(() =>
      Promise.resolve({
        actionStatus: 'should-not-run',
      }),
    );

    const result = await executePolicyAuthorizedReplayAction({
      stepId: 'sensitive-step',

      decision: {
        decision: 'REQUIRE_HUMAN',

        code: 'HUMAN_APPROVAL_REQUIRED',

        riskLevel: 'SENSITIVE_WRITE',
      },

      executeAction,
    });

    expect(executeAction).not.toHaveBeenCalled();

    expect(result).toEqual({
      status: 'intervention_required',

      intervention: {
        code: 'HUMAN_APPROVAL_REQUIRED',

        message: 'Replay action requires human approval.',

        details: {
          stepId: 'sensitive-step',

          riskLevel: 'SENSITIVE_WRITE',

          policyDecision: 'REQUIRE_HUMAN',
        },
      },
    });
  });

  it('never executes irreversible actions when policy requires human approval', async () => {
    const executeAction = vi.fn(() => Promise.resolve());

    const result = await executePolicyAuthorizedReplayAction({
      stepId: 'irreversible-step',

      decision: {
        decision: 'REQUIRE_HUMAN',

        code: 'HUMAN_APPROVAL_REQUIRED',

        riskLevel: 'IRREVERSIBLE',
      },

      executeAction,
    });

    expect(executeAction).not.toHaveBeenCalled();

    expect(result.status).toBe('intervention_required');
  });
});
