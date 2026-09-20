import { describe, expect, it } from 'vitest';

import { ReplayExecutionState } from '../../src/replay/index.js';

describe('replay execution state', () => {
  it('starts with deterministic empty execution state', () => {
    const state = new ReplayExecutionState({
      startedAt: 1_000,
    });

    expect(state.snapshot()).toEqual({
      currentStepIndex: 0,
      outputs: {},
      recoveryAttempts: {},
      startedAt: 1_000,
    });
  });

  it('tracks the current step index', () => {
    const state = new ReplayExecutionState({
      startedAt: 1_000,
    });

    state.setCurrentStepIndex(2);

    expect(state.stepIndex).toBe(2);

    expect(state.snapshot().currentStepIndex).toBe(2);
  });

  it('advances the current step deterministically', () => {
    const state = new ReplayExecutionState({
      startedAt: 1_000,
    });

    expect(state.advanceStep()).toBe(1);

    expect(state.advanceStep()).toBe(2);

    expect(state.stepIndex).toBe(2);
  });

  it('rejects invalid current step indexes', () => {
    const state = new ReplayExecutionState({
      startedAt: 1_000,
    });

    expect(() => state.setCurrentStepIndex(-1)).toThrow(
      'Replay currentStepIndex must be a non-negative integer',
    );

    expect(() => state.setCurrentStepIndex(1.5)).toThrow(
      'Replay currentStepIndex must be a non-negative integer',
    );
  });

  it('stores deterministic outputs', () => {
    const state = new ReplayExecutionState({
      startedAt: 1_000,
    });

    state.setOutput('savingsBalance', '$12,840.50');

    expect(state.hasOutput('savingsBalance')).toBe(true);

    expect(state.getOutput('savingsBalance')).toBe('$12,840.50');

    expect(state.snapshot().outputs).toEqual({
      savingsBalance: '$12,840.50',
    });
  });

  it('tracks recovery attempts by step and condition type', () => {
    const state = new ReplayExecutionState({
      startedAt: 1_000,
    });

    expect(state.incrementRecoveryAttempt('search-member', 'TRANSIENT_LOAD')).toBe(1);

    expect(state.incrementRecoveryAttempt('search-member', 'TRANSIENT_LOAD')).toBe(2);

    expect(state.recoveryAttemptCount('search-member', 'TRANSIENT_LOAD')).toBe(2);

    expect(state.snapshot().recoveryAttempts).toEqual({
      'search-member:TRANSIENT_LOAD': 2,
    });
  });

  it('keeps recovery counters isolated across steps', () => {
    const state = new ReplayExecutionState({
      startedAt: 1_000,
    });

    state.incrementRecoveryAttempt('step-1', 'TRANSIENT_LOAD');

    state.incrementRecoveryAttempt('step-2', 'TRANSIENT_LOAD');

    state.incrementRecoveryAttempt('step-2', 'TRANSIENT_LOAD');

    expect(state.recoveryAttemptCount('step-1', 'TRANSIENT_LOAD')).toBe(1);

    expect(state.recoveryAttemptCount('step-2', 'TRANSIENT_LOAD')).toBe(2);
  });

  it('keeps recovery counters isolated across condition types', () => {
    const state = new ReplayExecutionState({
      startedAt: 1_000,
    });

    state.incrementRecoveryAttempt('step-1', 'TRANSIENT_LOAD');

    state.incrementRecoveryAttempt('step-1', 'KNOWN_INTERSTITIAL');

    expect(state.recoveryAttemptCount('step-1', 'TRANSIENT_LOAD')).toBe(1);

    expect(state.recoveryAttemptCount('step-1', 'KNOWN_INTERSTITIAL')).toBe(1);
  });

  it('records only the latest deterministic observed state', () => {
    const state = new ReplayExecutionState({
      startedAt: 1_000,
    });

    state.recordObservedState({
      observationId: 'obs-1',

      capturedAt: '2026-09-20T21:00:00.000Z',

      url: 'https://bank.test/members',

      state: {
        loading: 'complete',
      },
    });

    state.recordObservedState({
      observationId: 'obs-2',

      capturedAt: '2026-09-20T21:00:01.000Z',

      url: 'https://bank.test/member/1',

      state: {
        loading: 'complete',
      },
    });

    expect(state.snapshot().lastObservedState).toEqual({
      observationId: 'obs-2',

      capturedAt: '2026-09-20T21:00:01.000Z',

      url: 'https://bank.test/member/1',

      state: {
        loading: 'complete',
      },
    });
  });

  it('does not expose LLM history or agent memory fields', () => {
    const state = new ReplayExecutionState({
      startedAt: 1_000,
    });

    const snapshot = state.snapshot();

    expect('messages' in snapshot).toBe(false);

    expect('history' in snapshot).toBe(false);

    expect('memory' in snapshot).toBe(false);

    expect('modelDecisions' in snapshot).toBe(false);

    expect('reasoning' in snapshot).toBe(false);
  });

  it('rejects invalid startedAt values', () => {
    expect(
      () =>
        new ReplayExecutionState({
          startedAt: -1,
        }),
    ).toThrow('Replay startedAt must be a finite non-negative number');

    expect(
      () =>
        new ReplayExecutionState({
          startedAt: Number.NaN,
        }),
    ).toThrow('Replay startedAt must be a finite non-negative number');
  });

  it('returns independent snapshots rather than mutable internal maps', () => {
    const state = new ReplayExecutionState({
      startedAt: 1_000,
    });

    state.setOutput('savingsBalance', '$12,840.50');

    const first = state.snapshot();

    state.setOutput('memberName', 'Alex Morgan');

    expect(first.outputs).toEqual({
      savingsBalance: '$12,840.50',
    });

    expect(state.snapshot().outputs).toEqual({
      savingsBalance: '$12,840.50',

      memberName: 'Alex Morgan',
    });
  });
});
