import type { RecoverableConditionCode } from '../runtime/index.js';

export type ReplayRecoveryAttemptResult =
  | {
      readonly status: 'recovered';
    }
  | {
      readonly status: 'still_recoverable';
    }
  | {
      readonly status: 'failed';

      readonly message: string;
    };

export type ReplayRecoveryFlowResult<T> =
  | {
      readonly status: 'success';

      readonly result: T;

      readonly recoveryAttempts: number;
    }
  | {
      readonly status: 'intervention_required';

      readonly intervention: {
        readonly code: 'RECOVERY_EXHAUSTED';

        readonly condition: RecoverableConditionCode;

        readonly attempts: number;

        readonly message: string;
      };
    }
  | {
      readonly status: 'failure';

      readonly error: {
        readonly code: 'ACTION_FAILED';

        readonly message: string;
      };
    };

export interface ReplayRecoveryFlowInput<T> {
  readonly condition: RecoverableConditionCode;

  readonly maxAttempts: number;

  readonly attemptRecovery: (attempt: number) => Promise<ReplayRecoveryAttemptResult>;

  readonly continueReplay: () => Promise<T>;
}

function assertRecoveryBudget(maxAttempts: number): void {
  if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
    throw new Error('Replay recovery maxAttempts must be a positive integer');
  }
}

/**
 * Orchestrates already-authorized recovery.
 *
 * It does not decide whether recovery is allowed.
 * Existing replay recovery policy, recovery budget, and
 * dialog recovery helpers remain authoritative.
 */
export async function executeReplayRecoveryFlow<T>(
  input: ReplayRecoveryFlowInput<T>,
): Promise<ReplayRecoveryFlowResult<T>> {
  assertRecoveryBudget(input.maxAttempts);

  for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
    const recovery = await input.attemptRecovery(attempt);

    if (recovery.status === 'failed') {
      return {
        status: 'failure',

        error: {
          code: 'ACTION_FAILED',

          message: recovery.message,
        },
      };
    }

    if (recovery.status === 'recovered') {
      return {
        status: 'success',

        result: await input.continueReplay(),

        recoveryAttempts: attempt,
      };
    }
  }

  return {
    status: 'intervention_required',

    intervention: {
      code: 'RECOVERY_EXHAUSTED',

      condition: input.condition,

      attempts: input.maxAttempts,

      message: `Recovery for ${input.condition} exhausted after ${input.maxAttempts} attempts.`,
    },
  };
}
