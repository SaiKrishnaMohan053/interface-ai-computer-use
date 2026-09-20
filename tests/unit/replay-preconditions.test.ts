import { describe, expect, it, vi } from 'vitest';

import { evaluateReplayPreconditions } from '../../src/replay/index.js';

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

function precondition(text: string): NonNullable<CapabilityStep['preconditions']>[number] {
  return {
    kind: 'textPresent',
    text,
    match: 'contains',
    caseSensitive: false,
  };
}

function step(
  options: {
    readonly preconditions?: CapabilityStep['preconditions'];
    readonly wait?: WaitPolicy;
  } = {},
): CapabilityStep {
  return {
    id: 'read-savings-balance',
    description: 'Read savings balance.',

    action: {
      kind: 'read',
      source: 'text',
      saveAs: {
        kind: 'outputRef',
        name: 'savingsBalance',
      },
    },

    target: {
      description: 'Savings balance',
      cardinality: 'exactly-one',
      strategies: [
        {
          kind: 'text',
          text: {
            value: 'Savings',
            mode: 'exact',
            caseSensitive: false,
          },
        },
      ],
    },

    ...(options.preconditions === undefined
      ? {}
      : {
          preconditions: options.preconditions,
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
  result:
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
  conditionId = 'condition',
): ConditionResult {
  const base = {
    ...scope,
    conditionId,
    startedAt: '2026-09-20T19:00:00.000Z',
    finishedAt: '2026-09-20T19:00:00.001Z',
    durationMs: 1,
    attempts: 1,
    expected: 'expected' in result ? (result.expected ?? true) : true,
    observed: 'observed' in result ? (result.observed ?? true) : true,
    evidenceRefs: [],
  } as const;

  switch (result.status) {
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
        reason: result.reason,
      };

    case 'error':
      return {
        ...base,
        status: 'error',
        passed: false,
        error: {
          code: result.errorCode,
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

describe('replay preconditions', () => {
  it('passes immediately when a step declares no preconditions', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>(() =>
      Promise.reject(new Error('evaluate should not be called')),
    );

    const result = await evaluateReplayPreconditions({
      adapter: adapterWithEvaluate(evaluate),
      step: step(),
      defaultWait,
    });

    expect(result).toEqual({
      status: 'passed',
      evidenceRefs: [],
    });

    expect(evaluate).not.toHaveBeenCalled();
  });

  it('passes when all declared preconditions pass', async () => {
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

    const result = await evaluateReplayPreconditions({
      adapter: adapterWithEvaluate(evaluate),

      step: step({
        preconditions: [precondition('Accounts'), precondition('Savings')],
      }),

      defaultWait,
    });

    expect(result.status).toBe('passed');

    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it('maps a failed precondition to CHECKPOINT_FAILED with precondition phase', async () => {
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

    const result = await evaluateReplayPreconditions({
      adapter: adapterWithEvaluate(evaluate),

      step: step({
        preconditions: [precondition('Accounts')],
      }),

      defaultWait,
    });

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('CHECKPOINT_FAILED');

      expect(result.error.details.phase).toBe('precondition');

      expect(result.error.details.reason).toBe('PRECONDITION_MISMATCH');

      expect(result.error.details.stepId).toBe('read-savings-balance');
    }
  });

  it('stops at the first failed precondition and preserves declared order', async () => {
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

    const result = await evaluateReplayPreconditions({
      adapter: adapterWithEvaluate(evaluate),

      step: step({
        preconditions: [precondition('First'), precondition('Second'), precondition('Third')],
      }),

      defaultWait,
    });

    expect(result.status).toBe('failure');

    expect(evaluate).toHaveBeenCalledTimes(1);

    const firstCall = evaluate.mock.calls[0];

    expect(firstCall).toBeDefined();

    expect(firstCall?.[0].conditionId).toBe('read-savings-balance:precondition:0');
  });

  it('maps a precondition timeout to CHECKPOINT_FAILED', async () => {
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

    const result = await evaluateReplayPreconditions({
      adapter: adapterWithEvaluate(evaluate),

      step: step({
        preconditions: [precondition('Accounts')],
      }),

      defaultWait,
    });

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('CHECKPOINT_FAILED');

      expect(result.error.details.reason).toBe('PRECONDITION_TIMEOUT');

      expect(result.error.details.phase).toBe('precondition');
    }
  });

  it('retains the underlying condition evaluation error code', async () => {
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

    const result = await evaluateReplayPreconditions({
      adapter: adapterWithEvaluate(evaluate),

      step: step({
        preconditions: [precondition('Accounts')],
      }),

      defaultWait,
    });

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('CHECKPOINT_FAILED');

      expect(result.error.details.reason).toBe('PRECONDITION_EVALUATION_ERROR');

      expect(result.error.details.underlyingErrorCode).toBe('TARGET_AMBIGUOUS');
    }
  });

  it('uses the artifact step wait policy when one is declared', async () => {
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
      timeoutMs: 7_000,
      pollIntervalMs: 250,
    };

    await evaluateReplayPreconditions({
      adapter: adapterWithEvaluate(evaluate),

      step: step({
        preconditions: [precondition('Accounts')],
        wait: artifactWait,
      }),

      defaultWait,
    });

    expect(evaluate).toHaveBeenCalledTimes(1);

    const call = evaluate.mock.calls[0];

    expect(call).toBeDefined();

    expect(call?.[1]).toEqual({
      timeoutMs: 7_000,
      pollIntervalMs: 250,
    });
  });

  it('uses deterministic default wait when the step has no wait policy', async () => {
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

    await evaluateReplayPreconditions({
      adapter: adapterWithEvaluate(evaluate),

      step: step({
        preconditions: [precondition('Accounts')],
      }),

      defaultWait,
    });

    expect(evaluate).toHaveBeenCalledTimes(1);

    const call = evaluate.mock.calls[0];

    expect(call).toBeDefined();

    expect(call?.[1]).toEqual({
      timeoutMs: 5_000,
      pollIntervalMs: 100,
    });
  });
});
