import { describe, expect, it, vi } from 'vitest';

import { evaluateReplayWait } from '../../src/replay/index.js';

import type { CapabilityStep } from '../../src/artifact/index.js';

import type { ConditionResult, SurfaceAdapter } from '../../src/surface/index.js';

import type { TargetStrategy } from '../../src/targeting/index.js';

const scope = {
  sessionId: 'replay-session',
  surfaceId: 'replay-surface',
} as const;

function waitStep(
  options: {
    readonly timeoutMs?: number;
    readonly pollIntervalMs?: number;
    readonly includeWaitPolicy?: boolean;
  } = {},
): CapabilityStep {
  return {
    id: 'wait-for-search',

    description: 'Wait for search loading to complete.',

    action: {
      kind: 'wait',
      condition: {
        kind: 'loadingComplete',
      },
    },

    ...(options.includeWaitPolicy === false
      ? {}
      : {
          wait: {
            timeoutMs: options.timeoutMs ?? 5_000,

            pollIntervalMs: options.pollIntervalMs ?? 100,
          },
        }),

    risk: 'READ_ONLY',
  };
}

function result(
  status: 'passed' | 'timeout' | 'mismatch' | 'error',
  conditionId: string,
): ConditionResult {
  const base = {
    ...scope,
    conditionId,
    startedAt: '2026-09-20T20:00:00.000Z',
    finishedAt: '2026-09-20T20:00:00.001Z',
    durationMs: 1,
    attempts: 1,
    expected: 'complete',
    observed: status === 'passed' ? 'complete' : 'loading',
    evidenceRefs: [],
  } as const;

  switch (status) {
    case 'passed':
      return {
        ...base,
        status: 'passed',
        passed: true,
      };

    case 'timeout':
      return {
        ...base,
        status: 'not_met',
        passed: false,
        reason: 'timeout',
      };

    case 'mismatch':
      return {
        ...base,
        status: 'not_met',
        passed: false,
        reason: 'mismatch',
      };

    case 'error':
      return {
        ...base,
        status: 'error',
        passed: false,

        error: {
          code: 'CONDITION_EVALUATION_FAILED',
          message: 'Condition evaluation failed.',
          expected: 'complete',
          observed: 'unknown',
        },
      };
  }
}

function adapter(
  evaluate: SurfaceAdapter<TargetStrategy>['evaluate'],
): SurfaceAdapter<TargetStrategy> {
  return {
    scope,

    observe: vi.fn(() => {
      throw new Error('observe should not be called directly');
    }),

    resolveTarget: vi.fn(() => {
      throw new Error('resolveTarget should not be called directly');
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

describe('replay wait policy', () => {
  it('evaluates an explicit wait condition through ConditionEvaluator', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>((request) =>
      Promise.resolve(result('passed', request.conditionId)),
    );

    const replayResult = await evaluateReplayWait({
      adapter: adapter(evaluate),
      step: waitStep(),
    });

    expect(replayResult.status).toBe('passed');

    expect(evaluate).toHaveBeenCalledTimes(1);

    const call = evaluate.mock.calls[0];

    expect(call?.[0].conditionId).toBe('wait-for-search:wait');
  });

  it('uses the exact artifact-defined timeout and polling interval', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>((request) =>
      Promise.resolve(result('passed', request.conditionId)),
    );

    await evaluateReplayWait({
      adapter: adapter(evaluate),

      step: waitStep({
        timeoutMs: 8_000,
        pollIntervalMs: 250,
      }),
    });

    const call = evaluate.mock.calls[0];

    expect(call?.[1]).toEqual({
      timeoutMs: 8_000,
      pollIntervalMs: 250,
    });
  });

  it('fails closed when an explicit wait step has no wait policy', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>(() =>
      Promise.reject(new Error('evaluate should not be called')),
    );

    const replayResult = await evaluateReplayWait({
      adapter: adapter(evaluate),

      step: waitStep({
        includeWaitPolicy: false,
      }),
    });

    expect(replayResult.status).toBe('failure');

    if (replayResult.status === 'failure') {
      expect(replayResult.error.code).toBe('CHECKPOINT_FAILED');

      expect(replayResult.error.details.reason).toBe('WAIT_POLICY_MISSING');

      expect(replayResult.error.details.phase).toBe('wait');
    }

    expect(evaluate).not.toHaveBeenCalled();
  });

  it('maps bounded timeout to CHECKPOINT_FAILED', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>((request) =>
      Promise.resolve(result('timeout', request.conditionId)),
    );

    const replayResult = await evaluateReplayWait({
      adapter: adapter(evaluate),
      step: waitStep(),
    });

    expect(replayResult.status).toBe('failure');

    if (replayResult.status === 'failure') {
      expect(replayResult.error.code).toBe('CHECKPOINT_FAILED');

      expect(replayResult.error.details.reason).toBe('WAIT_TIMEOUT');
    }
  });

  it('maps condition mismatch to CHECKPOINT_FAILED', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>((request) =>
      Promise.resolve(result('mismatch', request.conditionId)),
    );

    const replayResult = await evaluateReplayWait({
      adapter: adapter(evaluate),
      step: waitStep(),
    });

    expect(replayResult.status).toBe('failure');

    if (replayResult.status === 'failure') {
      expect(replayResult.error.details.reason).toBe('WAIT_CONDITION_MISMATCH');
    }
  });

  it('retains underlying condition evaluation errors', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>((request) =>
      Promise.resolve(result('error', request.conditionId)),
    );

    const replayResult = await evaluateReplayWait({
      adapter: adapter(evaluate),
      step: waitStep(),
    });

    expect(replayResult.status).toBe('failure');

    if (replayResult.status === 'failure') {
      expect(replayResult.error.details.reason).toBe('WAIT_EVALUATION_ERROR');

      expect(replayResult.error.details.underlyingErrorCode).toBe('CONDITION_EVALUATION_FAILED');
    }
  });

  it('rejects non-wait steps instead of synthesizing synchronization', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>(() =>
      Promise.reject(new Error('evaluate should not be called')),
    );

    const nonWaitStep: CapabilityStep = {
      id: 'click-search',
      description: 'Click search.',

      action: {
        kind: 'click',
      },

      risk: 'READ_ONLY',
    };

    const replayResult = await evaluateReplayWait({
      adapter: adapter(evaluate),
      step: nonWaitStep,
    });

    expect(replayResult.status).toBe('failure');

    if (replayResult.status === 'failure') {
      expect(replayResult.error.details.reason).toBe('NOT_A_WAIT_STEP');
    }

    expect(evaluate).not.toHaveBeenCalled();
  });
});
