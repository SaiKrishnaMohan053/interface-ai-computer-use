import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReplayRunTimeoutGuard, enforceReplayRunTimeout } from '../../src/replay/index.js';

describe('replay run timeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts within the configured total runtime budget', () => {
    const guard = new ReplayRunTimeoutGuard({
      startedAtMs: 1_000,

      limits: {
        maxDurationMs: 5_000,
      },

      now: () => 1_000,
    });

    expect(guard.snapshot()).toEqual({
      startedAtMs: 1_000,
      nowMs: 1_000,
      elapsedMs: 0,
      maxDurationMs: 5_000,
      remainingMs: 5_000,
      timedOut: false,
    });

    expect(guard.canContinue()).toBe(true);
  });

  it('reports remaining total runtime budget', () => {
    let now = 1_000;

    const guard = new ReplayRunTimeoutGuard({
      startedAtMs: 1_000,

      limits: {
        maxDurationMs: 5_000,
      },

      now: () => now,
    });

    now = 3_000;

    expect(guard.snapshot().remainingMs).toBe(3_000);
  });

  it('stops allowing work when total runtime reaches the deadline', () => {
    let now = 1_000;

    const guard = new ReplayRunTimeoutGuard({
      startedAtMs: 1_000,

      limits: {
        maxDurationMs: 5_000,
      },

      now: () => now,
    });

    now = 6_000;

    expect(guard.canContinue()).toBe(false);

    expect(guard.signal.aborted).toBe(true);
  });

  it('returns canonical RUN_TIMEOUT failure', () => {
    const guard = new ReplayRunTimeoutGuard({
      startedAtMs: 1_000,

      limits: {
        maxDurationMs: 5_000,
      },

      now: () => 6_500,
    });

    guard.canContinue();

    const failure = guard.failure('read-savings-balance');

    expect(failure.code).toBe('RUN_TIMEOUT');

    expect(failure.stepId).toBe('read-savings-balance');

    expect(failure.details.maxDurationMs).toBe(5_000);
  });

  it('aborts the shared signal when the wall-clock deadline fires', () => {
    vi.useFakeTimers();

    vi.setSystemTime(1_000);

    const guard = new ReplayRunTimeoutGuard({
      startedAtMs: Date.now(),

      limits: {
        maxDurationMs: 5_000,
      },
    });

    guard.start();

    expect(guard.signal.aborted).toBe(false);

    vi.advanceTimersByTime(5_000);

    expect(guard.signal.aborted).toBe(true);
  });

  it('does not create multiple run timers when start is called repeatedly', () => {
    vi.useFakeTimers();

    vi.setSystemTime(1_000);

    const guard = new ReplayRunTimeoutGuard({
      startedAtMs: Date.now(),

      limits: {
        maxDurationMs: 5_000,
      },
    });

    guard.start();
    guard.start();
    guard.start();

    expect(vi.getTimerCount()).toBe(1);

    guard.stop();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops the timer after terminal completion', () => {
    vi.useFakeTimers();

    const guard = new ReplayRunTimeoutGuard({
      startedAtMs: Date.now(),

      limits: {
        maxDurationMs: 5_000,
      },
    });

    guard.start();

    expect(vi.getTimerCount()).toBe(1);

    guard.stop();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses existing lifecycle failure callback when timeout is exceeded', async () => {
    const guard = new ReplayRunTimeoutGuard({
      startedAtMs: 1_000,

      limits: {
        maxDurationMs: 5_000,
      },

      now: () => 6_001,
    });

    const failRun = vi.fn(async (): Promise<void> => {});

    const result = await enforceReplayRunTimeout({
      guard,

      stepId: 'open-accounts',

      failRun,
    });

    expect(result.status).toBe('timed_out');

    expect(failRun).toHaveBeenCalledTimes(1);

    if (result.status === 'timed_out') {
      expect(result.failure.code).toBe('RUN_TIMEOUT');

      expect(result.failure.stepId).toBe('open-accounts');
    }
  });

  it('does not fail lifecycle while the run still has time remaining', async () => {
    const guard = new ReplayRunTimeoutGuard({
      startedAtMs: 1_000,

      limits: {
        maxDurationMs: 5_000,
      },

      now: () => 2_000,
    });

    const failRun = vi.fn(async (): Promise<void> => {});

    const result = await enforceReplayRunTimeout({
      guard,

      stepId: 'open-accounts',

      failRun,
    });

    expect(result).toEqual({
      status: 'continue',
    });

    expect(failRun).not.toHaveBeenCalled();
  });

  it('rejects invalid timeout configuration', () => {
    expect(
      () =>
        new ReplayRunTimeoutGuard({
          startedAtMs: 1_000,

          limits: {
            maxDurationMs: 0,
          },
        }),
    ).toThrow('Replay maxDurationMs must be a positive finite number');
  });
});
