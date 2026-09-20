import type { ReplayRunTimeoutFailure, ReplayRunTimeoutGuard } from './replay-run-timeout.js';

export interface ReplayTimeoutLifecycleInput {
  readonly guard: ReplayRunTimeoutGuard;

  readonly stepId: string | null;

  /**
   * Wire this callback to RunCoordinator.fail(...).
   *
   * RunCoordinator remains the owner of actual session,
   * surface, and evidence cleanup.
   */
  readonly failRun: (failure: ReplayRunTimeoutFailure) => Promise<void>;
}

export type ReplayTimeoutLifecycleResult =
  | {
      readonly status: 'continue';
    }
  | {
      readonly status: 'timed_out';

      readonly failure: ReplayRunTimeoutFailure;
    };

/**
 * Fail-closed timeout checkpoint.
 *
 * This helper never closes browser resources directly.
 * Existing RunCoordinator.fail() remains authoritative for
 * failure lifecycle cleanup.
 */
export async function enforceReplayRunTimeout(
  input: ReplayTimeoutLifecycleInput,
): Promise<ReplayTimeoutLifecycleResult> {
  if (input.guard.canContinue()) {
    return {
      status: 'continue',
    };
  }

  const failure = input.guard.failure(input.stepId);

  await input.failRun(failure);

  return {
    status: 'timed_out',
    failure,
  };
}
