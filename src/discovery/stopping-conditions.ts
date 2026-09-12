import type { SurfaceFailure, SurfaceFailureCode } from '../surface/index.js';

export const HARD_DISCOVERY_ACTION_FAILURE_CODES = [
  'ACTION_FAILED',
  'NAVIGATION_FAILED',
  'SURFACE_UNAVAILABLE',
  'UNSUPPORTED_OPERATION',
] as const satisfies readonly SurfaceFailureCode[];

export type DiscoveryLoopBudgetStopReason = 'cancelled' | 'run_timeout' | 'max_steps';

export interface DiscoveryLoopBudgetInput {
  readonly step: number;
  readonly maxSteps: number;
  readonly nowMs: number;
  readonly deadlineAt: string;
  readonly aborted: boolean;
}

/**
 * Evaluates bounded loop limits before the engine asks for another decision.
 */
export function evaluateDiscoveryLoopBudget(
  input: DiscoveryLoopBudgetInput,
): DiscoveryLoopBudgetStopReason | null {
  if (input.aborted) {
    return 'cancelled';
  }

  if (input.nowMs >= Date.parse(input.deadlineAt)) {
    return 'run_timeout';
  }

  if (input.step >= input.maxSteps) {
    return 'max_steps';
  }

  return null;
}

/**
 * Hard failures cannot be made safe by asking the model to retry.
 *
 * Target misses and stale observations remain recoverable. They are still
 * bounded by maximum steps, run timeout, and repeated-state detection.
 */
export function isHardDiscoveryActionFailure(error: SurfaceFailure): boolean {
  return HARD_DISCOVERY_ACTION_FAILURE_CODES.includes(
    error.code as (typeof HARD_DISCOVERY_ACTION_FAILURE_CODES)[number],
  );
}
