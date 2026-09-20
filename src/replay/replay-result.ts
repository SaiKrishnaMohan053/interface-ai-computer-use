import { parseRuntimeResult } from '../runtime/index.js';

import type {
  RuntimeBusinessOutcome,
  RuntimeFailure,
  RuntimeInterventionRequired,
  RuntimeResult,
  RuntimeSuccess,
} from '../runtime/index.js';

/**
 * Replay uses the canonical runtime terminal-result contract.
 *
 * We intentionally do not create a second replay-specific result hierarchy.
 *
 * RuntimeResult already distinguishes:
 *
 * - success
 * - business outcome
 * - intervention required
 * - failure
 *
 * and already carries:
 *
 * - run/session identity
 * - timing
 * - evidence references
 * - recoverable-condition history
 */
export type ReplayResult = RuntimeResult;

export type ReplaySuccess = RuntimeSuccess;

export type ReplayBusinessOutcome = RuntimeBusinessOutcome;

export type ReplayInterventionRequired = RuntimeInterventionRequired;

export type ReplayFailureResult = RuntimeFailure;

/**
 * Terminal replay failure payload.
 *
 * Useful debugging context already exists in the canonical runtime contract:
 *
 * - code
 * - message
 * - stepId
 * - expected
 * - observed
 * - details
 *
 * Evidence references and recoverable-condition history live on the enclosing
 * ReplayResult rather than being duplicated inside the error payload.
 */
export type ReplayFailure = RuntimeFailure['error'];

export function parseReplayResult(value: unknown): ReplayResult {
  return parseRuntimeResult(value);
}
