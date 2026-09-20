import { describe, expect, it, vi } from 'vitest';

import { evaluateReplayPostconditions } from '../../src/replay/index.js';

import type { CapabilityStep, WaitPolicy } from '../../src/artifact/index.js';

import type { ConditionResult, SurfaceAdapter } from '../../src/surface/index.js';

import type { TargetStrategy } from '../../src/targeting/index.js';

const scope = {
  sessionId: 'replay-session',
  surfaceId: 'replay-surface',
} as const;

const defaultWait: WaitPolicy = {
  timeoutMs: 5_000,
  pollIntervalMs: 100,
};

function postcondition(text: string): NonNullable<CapabilityStep['postconditions']>[number] {
  return {
    kind: 'textPresent',
    text,
    match: 'contains',
    caseSensitive: false,
  };
}

function step(
  options: {
    readonly postconditions?: CapabilityStep['postconditions'];
    readonly wait?: WaitPolicy;
  } = {},
): CapabilityStep {
  return {
    id: 'submit-member-search',
    description: 'Submit member search.',

    action: {
      kind: 'click',
    },

    target: {
      description: 'Search button',
      cardinality: 'exactly-one',
      strategies: [
        {
          kind: 'role-name',
          role: 'button',
          name: {
            value: 'Search',
            mode: 'exact',
            caseSensitive: false,
          },
        },
      ],
    },

    ...(options.postconditions === undefined
      ? {}
      : {
          postconditions: options.postconditions,
        }),

    ...(options.wait === undefined
      ? {}
      : {
          wait: options.wait,
        }),

    risk: 'READ_ONLY',
  };
}

function conditionResult(
  input:
    | {
        readonly status: 'passed';
      }
    | {
        readonly status: 'not_met';
        readonly reason: 'mismatch' | 'timeout';
        readonly expected?: boolean;
        readonly observed?: boolean;
      }
    | {
        readonly status: 'error';
        readonly errorCode:
          | 'TARGET_NOT_FOUND'
          | 'TARGET_AMBIGUOUS'
          | 'STALE_TARGET'
          | 'NAVIGATION_FAILED'
          | 'ACTION_FAILED'
          | 'CONDITION_TIMEOUT'
          | 'CONDITION_EVALUATION_FAILED'
          | 'UNSUPPORTED_OPERATION'
          | 'SURFACE_UNAVAILABLE';
      },
  conditionId: string,
): ConditionResult {
  const expected = 'expected' in input ? (input.expected ?? true) : true;

  const observed = 'observed' in input ? (input.observed ?? true) : true;

  const base = {
    ...scope,
    conditionId,
    startedAt: '2026-09-20T20:00:00.000Z',
    finishedAt: '2026-09-20T20:00:00.001Z',
    durationMs: 1,
    attempts: 1,
    expected,
    observed,
    evidenceRefs: [],
  } as const;

  switch (input.status) {
    case 'passed':
      return {
        ...base,
        status: 'passed',
        passed: true,
      };

    case 'not_met':
      return {
        ...base,
        status: 'not_met',
        passed: false,
        reason: input.reason,
      };

    case 'error':
      return {
        ...base,
        status: 'error',
        passed: false,

        error: {
          code: input.errorCode,
          message: 'Condition evaluation failed.',
          expected: true,
          observed: false,
        },
      };
  }
}

function adapterWithEvaluate(
  evaluate: SurfaceAdapter<TargetStrategy>['evaluate'],
): SurfaceAdapter<TargetStrategy> {
  return {
    scope,

    observe: vi.fn(() => {
      throw new Error('observe should not be called directly by this test');
    }),

    resolveTarget: vi.fn(() => {
      throw new Error('resolveTarget should not be called directly by this test');
    }),

    perform: vi.fn(() => {
      throw new Error('perform should not be called');
    }),

    evaluate,

    captureEvidence: vi.fn(() => {
      throw new Error('captureEvidence should not be called');
    }),
  };
}

describe('replay postconditions', () => {
  it('passes immediately when a step has no postconditions', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>(() =>
      Promise.reject(new Error('evaluate should not be called')),
    );

    const detectCurrentState = vi.fn(() =>
      Promise.resolve({
        status: 'none' as const,
      }),
    );

    const result = await evaluateReplayPostconditions({
      adapter: adapterWithEvaluate(evaluate),
      step: step(),
      defaultWait,
      detectCurrentState,
    });

    expect(result).toEqual({
      status: 'passed',
      evidenceRefs: [],
    });

    expect(evaluate).not.toHaveBeenCalled();
    expect(detectCurrentState).not.toHaveBeenCalled();
  });

  it('passes when all declared postconditions pass', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>((request) =>
      Promise.resolve(
        conditionResult(
          {
            status: 'passed',
          },
          request.conditionId,
        ),
      ),
    );

    const detectCurrentState = vi.fn(() =>
      Promise.resolve({
        status: 'none' as const,
      }),
    );

    const result = await evaluateReplayPostconditions({
      adapter: adapterWithEvaluate(evaluate),

      step: step({
        postconditions: [postcondition('Member Details'), postcondition('Accounts')],
      }),

      defaultWait,
      detectCurrentState,
    });

    expect(result.status).toBe('passed');

    expect(evaluate).toHaveBeenCalledTimes(2);

    expect(detectCurrentState).not.toHaveBeenCalled();
  });

  it('returns MEMBER_NOT_FOUND when a failed postcondition is explained by a known business outcome', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>((request) =>
      Promise.resolve(
        conditionResult(
          {
            status: 'not_met',
            reason: 'mismatch',
            expected: true,
            observed: false,
          },
          request.conditionId,
        ),
      ),
    );

    const detectCurrentState = vi.fn(() =>
      Promise.resolve({
        status: 'business_outcome' as const,
        code: 'MEMBER_NOT_FOUND',
        message: 'No member matched the supplied lookup input.',
      }),
    );

    const result = await evaluateReplayPostconditions({
      adapter: adapterWithEvaluate(evaluate),

      step: step({
        postconditions: [postcondition('Member Details')],
      }),

      defaultWait,
      detectCurrentState,
    });

    expect(result.status).toBe('business_outcome');

    if (result.status === 'business_outcome') {
      expect(result.outcome.code).toBe('MEMBER_NOT_FOUND');
    }

    expect(detectCurrentState).toHaveBeenCalledTimes(1);
  });

  it('returns a recoverable condition when runtime state explains the failed postcondition', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>((request) =>
      Promise.resolve(
        conditionResult(
          {
            status: 'not_met',
            reason: 'timeout',
            expected: 'complete' as never,
            observed: 'loading' as never,
          },
          request.conditionId,
        ),
      ),
    );

    const detectCurrentState = vi.fn(() =>
      Promise.resolve({
        status: 'recoverable' as const,
        code: 'TRANSIENT_LOAD',
        message: 'The application is still loading.',
      }),
    );

    const result = await evaluateReplayPostconditions({
      adapter: adapterWithEvaluate(evaluate),

      step: step({
        postconditions: [
          {
            kind: 'loadingComplete',
          },
        ],
      }),

      defaultWait,
      detectCurrentState,
    });

    expect(result.status).toBe('recoverable');

    if (result.status === 'recoverable') {
      expect(result.condition.code).toBe('TRANSIENT_LOAD');
    }
  });

  it('returns CHECKPOINT_FAILED when no known state explains a postcondition mismatch', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>((request) =>
      Promise.resolve(
        conditionResult(
          {
            status: 'not_met',
            reason: 'mismatch',
            expected: true,
            observed: false,
          },
          request.conditionId,
        ),
      ),
    );

    const detectCurrentState = vi.fn(() =>
      Promise.resolve({
        status: 'none' as const,
      }),
    );

    const result = await evaluateReplayPostconditions({
      adapter: adapterWithEvaluate(evaluate),

      step: step({
        postconditions: [postcondition('Member Details')],
      }),

      defaultWait,
      detectCurrentState,
    });

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('CHECKPOINT_FAILED');

      expect(result.error.details.phase).toBe('postcondition');

      expect(result.error.details.reason).toBe('POSTCONDITION_MISMATCH');
    }
  });

  it('returns CHECKPOINT_FAILED when a postcondition times out and no known state explains it', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>((request) =>
      Promise.resolve(
        conditionResult(
          {
            status: 'not_met',
            reason: 'timeout',
            expected: true,
            observed: false,
          },
          request.conditionId,
        ),
      ),
    );

    const result = await evaluateReplayPostconditions({
      adapter: adapterWithEvaluate(evaluate),

      step: step({
        postconditions: [postcondition('Member Details')],
      }),

      defaultWait,

      detectCurrentState: () =>
        Promise.resolve({
          status: 'none',
        }),
    });

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('CHECKPOINT_FAILED');

      expect(result.error.details.reason).toBe('POSTCONDITION_TIMEOUT');
    }
  });

  it('returns CHECKPOINT_FAILED while retaining an underlying evaluation error', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>((request) =>
      Promise.resolve(
        conditionResult(
          {
            status: 'error',
            errorCode: 'TARGET_AMBIGUOUS',
          },
          request.conditionId,
        ),
      ),
    );

    const result = await evaluateReplayPostconditions({
      adapter: adapterWithEvaluate(evaluate),

      step: step({
        postconditions: [postcondition('Member Details')],
      }),

      defaultWait,

      detectCurrentState: () =>
        Promise.resolve({
          status: 'none',
        }),
    });

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('CHECKPOINT_FAILED');

      expect(result.error.details.reason).toBe('POSTCONDITION_EVALUATION_ERROR');

      expect(result.error.details.underlyingErrorCode).toBe('TARGET_AMBIGUOUS');
    }
  });

  it('stops evaluating later postconditions after the first unexplained failure', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>((request) =>
      Promise.resolve(
        conditionResult(
          {
            status: 'not_met',
            reason: 'mismatch',
            expected: true,
            observed: false,
          },
          request.conditionId,
        ),
      ),
    );

    const result = await evaluateReplayPostconditions({
      adapter: adapterWithEvaluate(evaluate),

      step: step({
        postconditions: [postcondition('First'), postcondition('Second'), postcondition('Third')],
      }),

      defaultWait,

      detectCurrentState: () =>
        Promise.resolve({
          status: 'none',
        }),
    });

    expect(result.status).toBe('failure');

    expect(evaluate).toHaveBeenCalledTimes(1);

    const call = evaluate.mock.calls[0];

    expect(call?.[0].conditionId).toBe('submit-member-search:postcondition:0');
  });

  it('prefers the artifact step wait policy over runtime default wait', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>((request) =>
      Promise.resolve(
        conditionResult(
          {
            status: 'passed',
          },
          request.conditionId,
        ),
      ),
    );

    const artifactWait: WaitPolicy = {
      timeoutMs: 9_000,
      pollIntervalMs: 250,
    };

    await evaluateReplayPostconditions({
      adapter: adapterWithEvaluate(evaluate),

      step: step({
        postconditions: [postcondition('Member Details')],
        wait: artifactWait,
      }),

      defaultWait,

      detectCurrentState: () =>
        Promise.resolve({
          status: 'none',
        }),
    });

    const call = evaluate.mock.calls[0];

    expect(call?.[1]).toEqual({
      timeoutMs: 9_000,
      pollIntervalMs: 250,
    });
  });
});
