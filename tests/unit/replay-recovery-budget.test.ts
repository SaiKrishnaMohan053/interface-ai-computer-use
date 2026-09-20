import { describe, expect, it, vi } from 'vitest';

import { ReplayRecoveryBudget } from '../../src/replay/index.js';

describe('replay recovery budget', () => {
  it('starts with an available recovery budget', () => {
    const now = vi.fn(() => 1_000);

    const budget = new ReplayRecoveryBudget(
      'submit-member-search',
      'TRANSIENT_LOAD',
      {
        maxAttempts: 2,
        maxRecoveryDurationMs: 10_000,
      },
      1_000,
      now,
    );

    const result = budget.check();

    expect(result.status).toBe('available');

    expect(result.snapshot).toEqual({
      stepId: 'submit-member-search',
      conditionCode: 'TRANSIENT_LOAD',
      attemptsUsed: 0,
      maxAttempts: 2,
      elapsedMs: 0,
      maxRecoveryDurationMs: 10_000,
    });
  });

  it('increments attempts when an attempt is consumed', () => {
    const now = vi.fn(() => 1_000);

    const budget = new ReplayRecoveryBudget(
      'submit-member-search',
      'TRANSIENT_LOAD',
      {
        maxAttempts: 2,
        maxRecoveryDurationMs: 10_000,
      },
      1_000,
      now,
    );

    const first = budget.consumeAttempt();

    expect(first.status).toBe('available');

    expect(first.snapshot.attemptsUsed).toBe(1);

    const second = budget.consumeAttempt();

    expect(second.status).toBe('available');

    expect(second.snapshot.attemptsUsed).toBe(2);
  });

  it('does not allow a third attempt when maxAttempts is 2', () => {
    const now = vi.fn(() => 1_000);

    const budget = new ReplayRecoveryBudget(
      'submit-member-search',
      'TRANSIENT_LOAD',
      {
        maxAttempts: 2,
        maxRecoveryDurationMs: 10_000,
      },
      1_000,
      now,
    );

    expect(budget.consumeAttempt().status).toBe('available');

    expect(budget.consumeAttempt().status).toBe('available');

    const third = budget.consumeAttempt();

    expect(third.status).toBe('exhausted');

    if (third.status === 'exhausted') {
      expect(third.reason).toBe('MAX_ATTEMPTS');

      expect(third.snapshot.attemptsUsed).toBe(2);
    }
  });

  it('reports the budget as available while elapsed duration is below the limit', () => {
    let currentTime = 5_000;

    const now = vi.fn(() => currentTime);

    const budget = new ReplayRecoveryBudget(
      'open-accounts',
      'TRANSIENT_LOAD',
      {
        maxAttempts: 3,
        maxRecoveryDurationMs: 5_000,
      },
      5_000,
      now,
    );

    currentTime = 9_999;

    const result = budget.check();

    expect(result.status).toBe('available');

    expect(result.snapshot.elapsedMs).toBe(4_999);
  });

  it('exhausts the budget when elapsed duration reaches the configured limit', () => {
    let currentTime = 5_000;

    const now = vi.fn(() => currentTime);

    const budget = new ReplayRecoveryBudget(
      'open-accounts',
      'TRANSIENT_LOAD',
      {
        maxAttempts: 3,
        maxRecoveryDurationMs: 5_000,
      },
      5_000,
      now,
    );

    currentTime = 10_000;

    const result = budget.check();

    expect(result.status).toBe('exhausted');

    if (result.status === 'exhausted') {
      expect(result.reason).toBe('MAX_RECOVERY_DURATION');

      expect(result.snapshot.elapsedMs).toBe(5_000);
    }
  });

  it('exhausts the budget when elapsed duration exceeds the configured limit', () => {
    let currentTime = 1_000;

    const now = vi.fn(() => currentTime);

    const budget = new ReplayRecoveryBudget(
      'open-accounts',
      'TRANSIENT_LOAD',
      {
        maxAttempts: 3,
        maxRecoveryDurationMs: 2_000,
      },
      1_000,
      now,
    );

    currentTime = 3_500;

    const result = budget.check();

    expect(result.status).toBe('exhausted');

    if (result.status === 'exhausted') {
      expect(result.reason).toBe('MAX_RECOVERY_DURATION');

      expect(result.snapshot.elapsedMs).toBe(2_500);
    }
  });

  it('returns MAX_ATTEMPTS when the attempt budget is exhausted first', () => {
    const now = vi.fn(() => 1_500);

    const budget = new ReplayRecoveryBudget(
      'submit-member-search',
      'TRANSIENT_LOAD',
      {
        maxAttempts: 2,
        maxRecoveryDurationMs: 10_000,
      },
      1_000,
      now,
    );

    budget.consumeAttempt();
    budget.consumeAttempt();

    const result = budget.check();

    expect(result.status).toBe('exhausted');

    if (result.status === 'exhausted') {
      expect(result.reason).toBe('MAX_ATTEMPTS');
    }
  });

  it('returns MAX_RECOVERY_DURATION when elapsed-time budget is exhausted before attempts', () => {
    let currentTime = 1_000;

    const now = vi.fn(() => currentTime);

    const budget = new ReplayRecoveryBudget(
      'submit-member-search',
      'TRANSIENT_LOAD',
      {
        maxAttempts: 3,
        maxRecoveryDurationMs: 2_000,
      },
      1_000,
      now,
    );

    budget.consumeAttempt();

    currentTime = 3_000;

    const result = budget.check();

    expect(result.status).toBe('exhausted');

    if (result.status === 'exhausted') {
      expect(result.reason).toBe('MAX_RECOVERY_DURATION');

      expect(result.snapshot.attemptsUsed).toBe(1);
    }
  });

  it('preserves step ID, condition type, attempts used, and elapsed time in snapshots', () => {
    let currentTime = 10_000;

    const now = vi.fn(() => currentTime);

    const budget = new ReplayRecoveryBudget(
      'read-savings-balance',
      'KNOWN_INTERSTITIAL',
      {
        maxAttempts: 2,
        maxRecoveryDurationMs: 20_000,
      },
      10_000,
      now,
    );

    budget.consumeAttempt();

    currentTime = 12_750;

    const snapshot = budget.snapshot();

    expect(snapshot).toEqual({
      stepId: 'read-savings-balance',
      conditionCode: 'KNOWN_INTERSTITIAL',
      attemptsUsed: 1,
      maxAttempts: 2,
      elapsedMs: 2_750,
      maxRecoveryDurationMs: 20_000,
    });
  });

  it('uses the injected clock and does not depend on real timers', () => {
    let currentTime = 100;

    const now = vi.fn(() => currentTime);

    const budget = new ReplayRecoveryBudget(
      'submit-member-search',
      'TRANSIENT_LOAD',
      {
        maxAttempts: 2,
        maxRecoveryDurationMs: 1_000,
      },
      100,
      now,
    );

    expect(budget.snapshot().elapsedMs).toBe(0);

    currentTime = 500;

    expect(budget.snapshot().elapsedMs).toBe(400);

    currentTime = 1_100;

    const result = budget.check();

    expect(result.status).toBe('exhausted');

    if (result.status === 'exhausted') {
      expect(result.reason).toBe('MAX_RECOVERY_DURATION');
    }

    expect(now).toHaveBeenCalled();

    /*
     * No fake timers, setTimeout, sleep, or wall-clock waiting
     * is needed. Time is entirely deterministic through the
     * injected clock.
     */
  });

  it('does not increment attempts when consumeAttempt is called after attempt exhaustion', () => {
    const now = vi.fn(() => 1_000);

    const budget = new ReplayRecoveryBudget(
      'submit-member-search',
      'TRANSIENT_LOAD',
      {
        maxAttempts: 1,
        maxRecoveryDurationMs: 10_000,
      },
      1_000,
      now,
    );

    const first = budget.consumeAttempt();

    expect(first.status).toBe('available');

    expect(first.snapshot.attemptsUsed).toBe(1);

    const second = budget.consumeAttempt();

    expect(second.status).toBe('exhausted');

    expect(second.snapshot.attemptsUsed).toBe(1);
  });

  it('does not consume an attempt when duration budget is already exhausted', () => {
    let currentTime = 1_000;

    const now = vi.fn(() => currentTime);

    const budget = new ReplayRecoveryBudget(
      'submit-member-search',
      'TRANSIENT_LOAD',
      {
        maxAttempts: 3,
        maxRecoveryDurationMs: 500,
      },
      1_000,
      now,
    );

    currentTime = 1_500;

    const result = budget.consumeAttempt();

    expect(result.status).toBe('exhausted');

    if (result.status === 'exhausted') {
      expect(result.reason).toBe('MAX_RECOVERY_DURATION');

      expect(result.snapshot.attemptsUsed).toBe(0);
    }
  });

  it('clamps negative elapsed time to zero when an injected clock moves backwards', () => {
    const now = vi.fn(() => 900);

    const budget = new ReplayRecoveryBudget(
      'submit-member-search',
      'TRANSIENT_LOAD',
      {
        maxAttempts: 2,
        maxRecoveryDurationMs: 5_000,
      },
      1_000,
      now,
    );

    const snapshot = budget.snapshot();

    expect(snapshot.elapsedMs).toBe(0);

    expect(budget.check().status).toBe('available');
  });
});
