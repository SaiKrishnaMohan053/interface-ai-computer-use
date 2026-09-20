export interface ReplayRecoveryBudgetLimits {
  readonly maxAttempts: number;
  readonly maxRecoveryDurationMs: number;
}

export interface ReplayRecoveryBudgetSnapshot {
  readonly stepId: string;
  readonly conditionCode: string;

  readonly attemptsUsed: number;
  readonly maxAttempts: number;

  readonly elapsedMs: number;
  readonly maxRecoveryDurationMs: number;
}

export type ReplayRecoveryBudgetCheck =
  | {
      readonly status: 'available';

      readonly snapshot: ReplayRecoveryBudgetSnapshot;
    }
  | {
      readonly status: 'exhausted';

      readonly reason: 'MAX_ATTEMPTS' | 'MAX_RECOVERY_DURATION';

      readonly snapshot: ReplayRecoveryBudgetSnapshot;
    };

/**
 * Deterministic recovery budget.
 *
 * It owns no timers and performs no sleeping.
 *
 * Time is supplied by an injected clock so
 * tests remain deterministic and production
 * callers may use their runtime clock.
 */
export class ReplayRecoveryBudget {
  private attemptsUsed = 0;

  constructor(
    private readonly stepId: string,

    private readonly conditionCode: string,

    private readonly limits: ReplayRecoveryBudgetLimits,

    private readonly startedAtMs: number,

    private readonly now: () => number,
  ) {
    if (!Number.isInteger(limits.maxAttempts) || limits.maxAttempts <= 0) {
      throw new Error('Recovery maxAttempts must be a positive integer');
    }

    if (!Number.isFinite(limits.maxRecoveryDurationMs) || limits.maxRecoveryDurationMs <= 0) {
      throw new Error('Recovery maxRecoveryDurationMs must be positive');
    }

    if (!Number.isFinite(startedAtMs)) {
      throw new Error('Recovery startedAtMs must be finite');
    }
  }

  snapshot(): ReplayRecoveryBudgetSnapshot {
    const elapsedMs = Math.max(0, this.now() - this.startedAtMs);

    return {
      stepId: this.stepId,

      conditionCode: this.conditionCode,

      attemptsUsed: this.attemptsUsed,

      maxAttempts: this.limits.maxAttempts,

      elapsedMs,

      maxRecoveryDurationMs: this.limits.maxRecoveryDurationMs,
    };
  }

  /**
   * Checks whether another recovery attempt
   * may begin.
   *
   * Attempt count takes precedence if both
   * limits happen to be exhausted at the same
   * observation point.
   */
  check(): ReplayRecoveryBudgetCheck {
    const snapshot = this.snapshot();

    if (snapshot.attemptsUsed >= snapshot.maxAttempts) {
      return {
        status: 'exhausted',

        reason: 'MAX_ATTEMPTS',

        snapshot,
      };
    }

    if (snapshot.elapsedMs >= snapshot.maxRecoveryDurationMs) {
      return {
        status: 'exhausted',

        reason: 'MAX_RECOVERY_DURATION',

        snapshot,
      };
    }

    return {
      status: 'available',
      snapshot,
    };
  }

  /**
   * Atomically checks the current budget and,
   * when still available, consumes one attempt.
   *
   * Calling this after exhaustion never grows
   * attemptsUsed beyond maxAttempts.
   */
  consumeAttempt(): ReplayRecoveryBudgetCheck {
    const before = this.check();

    if (before.status === 'exhausted') {
      return before;
    }

    this.attemptsUsed += 1;

    return {
      status: 'available',

      snapshot: this.snapshot(),
    };
  }
}
