import { describe, expect, it, vi } from 'vitest';

import { detectReplayTerminalState } from '../../src/replay/index.js';

import type { ConditionResult, SurfaceAdapter } from '../../src/surface/index.js';

import type { TargetStrategy } from '../../src/targeting/index.js';

const scope = {
  sessionId: 'replay-session',
  surfaceId: 'replay-surface',
} as const;

function passed(conditionId: string): ConditionResult {
  return {
    ...scope,

    conditionId,

    startedAt: '2026-09-20T21:00:00.000Z',

    finishedAt: '2026-09-20T21:00:00.001Z',

    durationMs: 1,
    attempts: 1,

    expected: true,
    observed: true,

    evidenceRefs: [],

    status: 'passed',
    passed: true,
  };
}

function notMet(conditionId: string): ConditionResult {
  return {
    ...scope,

    conditionId,

    startedAt: '2026-09-20T21:00:00.000Z',

    finishedAt: '2026-09-20T21:00:00.001Z',

    durationMs: 1,
    attempts: 1,

    expected: true,
    observed: false,

    evidenceRefs: [],

    status: 'not_met',
    passed: false,
    reason: 'mismatch',
  };
}

function evaluationError(conditionId: string): ConditionResult {
  return {
    ...scope,

    conditionId,

    startedAt: '2026-09-20T21:00:00.000Z',

    finishedAt: '2026-09-20T21:00:00.001Z',

    durationMs: 1,
    attempts: 1,

    expected: true,
    observed: false,

    evidenceRefs: [],

    status: 'error',
    passed: false,

    error: {
      code: 'CONDITION_EVALUATION_FAILED',

      message: 'Condition evaluation failed.',

      expected: true,
      observed: false,
    },
  };
}

function adapter(
  evaluate: SurfaceAdapter<TargetStrategy>['evaluate'],
): SurfaceAdapter<TargetStrategy> {
  return {
    scope,

    observe: vi.fn(() => Promise.reject(new Error('observe should not be called directly'))),

    resolveTarget: vi.fn(() => Promise.reject(new Error('resolveTarget should not be called'))),

    perform: vi.fn(() => Promise.reject(new Error('perform should not be called'))),

    evaluate,

    captureEvidence: vi.fn(() => Promise.reject(new Error('captureEvidence should not be called'))),
  };
}

const wait = {
  timeoutMs: 1_000,
  pollIntervalMs: 100,
} as const;

describe('replay terminal state detector', () => {
  it('classifies permission denied as a business outcome', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>((request) => {
      if (request.conditionId === 'runtime-state:session-expired') {
        return Promise.resolve(notMet(request.conditionId));
      }

      return Promise.resolve(passed(request.conditionId));
    });

    const result = await detectReplayTerminalState({
      adapter: adapter(evaluate),

      wait,
    });

    expect(result.signal.kind).toBe('business_outcome');

    if (result.signal.kind === 'business_outcome') {
      expect(result.signal.outcome.code).toBe('PERMISSION_DENIED');
    }
  });

  it('does not classify permission denied as a hard failure', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>((request) => {
      if (request.conditionId === 'runtime-state:session-expired') {
        return Promise.resolve(notMet(request.conditionId));
      }

      return Promise.resolve(passed(request.conditionId));
    });

    const result = await detectReplayTerminalState({
      adapter: adapter(evaluate),

      wait,
    });

    expect(result.signal.kind).not.toBe('failure');

    expect(result.signal.kind).toBe('business_outcome');
  });

  it('returns SESSION_EXPIRED_UNRECOVERABLE when session expiration is detected', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>((request) =>
      Promise.resolve(passed(request.conditionId)),
    );

    const result = await detectReplayTerminalState({
      adapter: adapter(evaluate),

      wait,
    });

    expect(result.signal.kind).toBe('failure');

    if (result.signal.kind === 'failure') {
      expect(result.signal.code).toBe('SESSION_EXPIRED_UNRECOVERABLE');

      expect(result.signal.details?.recoveryDeclared).toBe(false);
    }
  });

  it('stops after detecting session expiration and does not evaluate permission denied', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>((request) =>
      Promise.resolve(passed(request.conditionId)),
    );

    await detectReplayTerminalState({
      adapter: adapter(evaluate),

      wait,
    });

    expect(evaluate).toHaveBeenCalledTimes(1);

    expect(evaluate.mock.calls[0]?.[0].conditionId).toBe('runtime-state:session-expired');
  });

  it('returns none when neither session expiration nor permission denial is present', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>((request) =>
      Promise.resolve(notMet(request.conditionId)),
    );

    const result = await detectReplayTerminalState({
      adapter: adapter(evaluate),

      wait,
    });

    expect(result.signal).toEqual({
      kind: 'none',
    });

    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it('fails closed when session expiration detection cannot be evaluated reliably', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>((request) =>
      Promise.resolve(evaluationError(request.conditionId)),
    );

    const result = await detectReplayTerminalState({
      adapter: adapter(evaluate),

      wait,
    });

    expect(result.signal.kind).toBe('failure');

    if (result.signal.kind === 'failure') {
      expect(result.signal.code).toBe('CHECKPOINT_FAILED');

      expect(result.signal.details?.detector).toBe('SESSION_EXPIRED');

      expect(result.signal.details?.underlyingErrorCode).toBe('CONDITION_EVALUATION_FAILED');
    }

    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it('fails closed when permission denial detection cannot be evaluated reliably', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>((request) => {
      if (request.conditionId === 'runtime-state:session-expired') {
        return Promise.resolve(notMet(request.conditionId));
      }

      return Promise.resolve(evaluationError(request.conditionId));
    });

    const result = await detectReplayTerminalState({
      adapter: adapter(evaluate),

      wait,
    });

    expect(result.signal.kind).toBe('failure');

    if (result.signal.kind === 'failure') {
      expect(result.signal.code).toBe('CHECKPOINT_FAILED');

      expect(result.signal.details?.detector).toBe('PERMISSION_DENIED');
    }
  });

  it('evaluates session expiration before permission denial', async () => {
    const conditionIds: string[] = [];

    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>((request) => {
      conditionIds.push(request.conditionId);

      return Promise.resolve(notMet(request.conditionId));
    });

    await detectReplayTerminalState({
      adapter: adapter(evaluate),

      wait,
    });

    expect(conditionIds).toEqual([
      'runtime-state:session-expired',
      'runtime-state:permission-denied',
    ]);
  });

  it('uses the supplied bounded wait policy for both runtime-state checks', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>((request) =>
      Promise.resolve(notMet(request.conditionId)),
    );

    await detectReplayTerminalState({
      adapter: adapter(evaluate),

      wait: {
        timeoutMs: 2_500,
        pollIntervalMs: 125,
      },
    });

    expect(evaluate).toHaveBeenCalledTimes(2);

    expect(evaluate.mock.calls[0]?.[1]).toMatchObject({
      timeoutMs: 2_500,
      pollIntervalMs: 125,
    });

    expect(evaluate.mock.calls[1]?.[1]).toMatchObject({
      timeoutMs: 2_500,
      pollIntervalMs: 125,
    });
  });

  it('does not perform browser actions while detecting terminal states', async () => {
    const surface = adapter(
      vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>((request) =>
        Promise.resolve(notMet(request.conditionId)),
      ),
    );

    const performSpy = vi.spyOn(surface, 'perform');

    const resolveTargetSpy = vi.spyOn(surface, 'resolveTarget');

    await detectReplayTerminalState({
      adapter: surface,
      wait,
    });

    expect(performSpy).not.toHaveBeenCalled();

    expect(resolveTargetSpy).not.toHaveBeenCalled();
  });
});
