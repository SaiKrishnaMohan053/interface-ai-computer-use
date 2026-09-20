import type { CoordinatedRunContext } from '../runtime/index.js';

import type { SessionManagerErrorCode, SessionOwner, SessionState } from '../session/index.js';

import type { JsonValue } from '../surface/index.js';

export interface ReplaySessionOwnershipSnapshot {
  readonly mode: string;
  readonly state: SessionState;
  readonly owner: SessionOwner;
  readonly sessionId: string;
}

export type ReplaySessionOwnershipBlockReason =
  'WRONG_RUN_MODE' | 'SESSION_NOT_ACTIVE' | 'REPLAY_NOT_OWNER';

export interface ReplaySessionOwnershipBlocked {
  readonly status: 'blocked';

  readonly reason: ReplaySessionOwnershipBlockReason;

  readonly message: string;

  /**
   * Strongly typed snapshot is retained separately so
   * callers do not need to recover typed values from
   * generic JsonValue diagnostic metadata.
   */
  readonly snapshot: ReplaySessionOwnershipSnapshot;

  readonly details: Readonly<Record<string, JsonValue>>;
}

export interface ReplaySessionOwnershipAllowed {
  readonly status: 'allowed';

  readonly snapshot: ReplaySessionOwnershipSnapshot;
}

export type ReplaySessionOwnershipResult =
  ReplaySessionOwnershipAllowed | ReplaySessionOwnershipBlocked;

function blocked(
  reason: ReplaySessionOwnershipBlockReason,
  message: string,
  snapshot: ReplaySessionOwnershipSnapshot,
): ReplaySessionOwnershipBlocked {
  return {
    status: 'blocked',

    reason,

    message,

    snapshot,

    details: {
      mode: snapshot.mode,
      sessionState: snapshot.state,
      sessionOwner: snapshot.owner,
      sessionId: snapshot.sessionId,
    },
  };
}

/**
 * Must be checked before any replay browser action.
 *
 * This helper never acquires, transfers, or steals
 * ownership.
 *
 * RunCoordinator.start({ mode: 'REPLAY' }) remains
 * authoritative for acquiring replay ownership.
 */
export function checkReplaySessionOwnership<TStrategy>(
  context: CoordinatedRunContext<TStrategy>,
): ReplaySessionOwnershipResult {
  const session = context.sessionManager.snapshot();

  const snapshot: ReplaySessionOwnershipSnapshot = {
    mode: context.mode,

    state: session.state,

    owner: session.owner,

    sessionId: session.sessionId,
  };

  if (context.mode !== 'REPLAY') {
    return blocked(
      'WRONG_RUN_MODE',

      'Replay execution requires a coordinated run in REPLAY mode.',

      snapshot,
    );
  }

  if (session.state !== 'ACTIVE') {
    return blocked(
      'SESSION_NOT_ACTIVE',

      'Replay browser actions require an active session.',

      snapshot,
    );
  }

  if (session.owner !== 'REPLAY') {
    return blocked(
      'REPLAY_NOT_OWNER',

      'Replay cannot perform browser actions because the session is owned by another actor.',

      snapshot,
    );
  }

  return {
    status: 'allowed',
    snapshot,
  };
}

export interface ReplayOwnershipFailure {
  readonly code: 'ACTION_FAILED';

  readonly message: string;

  readonly stepId: string | null;

  readonly expected: JsonValue;

  readonly observed: JsonValue;

  readonly details: Readonly<Record<string, JsonValue>>;
}

/**
 * Converts an ownership block into the closest
 * existing runtime failure taxonomy.
 *
 * SessionManager owns the detailed ownership-error
 * taxonomy, so replay does not invent a duplicate
 * runtime OWNERSHIP_CONFLICT code.
 */
export function replayOwnershipFailure(
  result: ReplaySessionOwnershipBlocked,

  stepId: string | null,
): ReplayOwnershipFailure {
  return {
    code: 'ACTION_FAILED',

    message: result.message,

    stepId,

    expected: {
      mode: 'REPLAY',
      sessionState: 'ACTIVE',
      sessionOwner: 'REPLAY',
    },

    observed: {
      mode: result.snapshot.mode,

      sessionState: result.snapshot.state,

      sessionOwner: result.snapshot.owner,
    },

    details: {
      phase: 'session_ownership',

      reason: result.reason,

      sessionId: result.snapshot.sessionId,
    },
  };
}

/**
 * SessionManager errors that indicate replay does
 * not currently have authority to perform browser
 * operations.
 */
export function isReplayOwnershipError(code: SessionManagerErrorCode): boolean {
  return (
    code === 'OWNERSHIP_CONFLICT' ||
    code === 'OWNERSHIP_MISMATCH' ||
    code === 'HUMAN_CONTROL_ACTIVE'
  );
}
