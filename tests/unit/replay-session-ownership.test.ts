import { describe, expect, it } from 'vitest';

import {
  checkReplaySessionOwnership,
  isReplayOwnershipError,
  replayOwnershipFailure,
} from '../../src/replay/index.js';

import type { CoordinatedRunContext } from '../../src/runtime/index.js';

import type { SessionOwner, SessionState } from '../../src/session/index.js';

interface FakeSessionManager {
  snapshot(): {
    readonly sessionId: string;
    readonly state: SessionState;
    readonly owner: SessionOwner;
    readonly failureReason: null;
  };
}

function context(
  options: {
    readonly mode?: 'DISCOVERY' | 'REPLAY';

    readonly state?: SessionState;

    readonly owner?: SessionOwner;
  } = {},
): CoordinatedRunContext<never> {
  const sessionManager: FakeSessionManager = {
    snapshot: () => ({
      sessionId: 'session-1',

      state: options.state ?? 'ACTIVE',

      owner: options.owner ?? 'REPLAY',

      failureReason: null,
    }),
  };

  return {
    runId: 'run-1',

    mode: options.mode ?? 'REPLAY',

    sessionManager: sessionManager as CoordinatedRunContext<never>['sessionManager'],

    evidenceRecorder: {} as CoordinatedRunContext<never>['evidenceRecorder'],

    policyEngine: {} as CoordinatedRunContext<never>['policyEngine'],

    surface: {} as CoordinatedRunContext<never>['surface'],
  };
}

describe('replay session ownership', () => {
  it('allows replay actions only for an ACTIVE REPLAY-owned session', () => {
    const result = checkReplaySessionOwnership(context());

    expect(result.status).toBe('allowed');

    if (result.status === 'allowed') {
      expect(result.snapshot.mode).toBe('REPLAY');

      expect(result.snapshot.state).toBe('ACTIVE');

      expect(result.snapshot.owner).toBe('REPLAY');
    }
  });

  it('blocks execution when coordinated run mode is not REPLAY', () => {
    const result = checkReplaySessionOwnership(
      context({
        mode: 'DISCOVERY',
        owner: 'DISCOVERY',
      }),
    );

    expect(result.status).toBe('blocked');

    if (result.status === 'blocked') {
      expect(result.reason).toBe('WRONG_RUN_MODE');
    }
  });

  it('blocks execution when the session is paused', () => {
    const result = checkReplaySessionOwnership(
      context({
        state: 'PAUSED',
      }),
    );

    expect(result.status).toBe('blocked');

    if (result.status === 'blocked') {
      expect(result.reason).toBe('SESSION_NOT_ACTIVE');
    }
  });

  it('blocks execution when the session is owned by HUMAN', () => {
    const result = checkReplaySessionOwnership(
      context({
        state: 'PAUSED',
        owner: 'HUMAN',
      }),
    );

    expect(result.status).toBe('blocked');

    /*
     * State is checked first because HUMAN ownership is only
     * legal while paused under SessionManager semantics.
     */
    if (result.status === 'blocked') {
      expect(result.reason).toBe('SESSION_NOT_ACTIVE');
    }
  });

  it('blocks execution when another automation actor owns the active session', () => {
    const result = checkReplaySessionOwnership(
      context({
        owner: 'DISCOVERY',
      }),
    );

    expect(result.status).toBe('blocked');

    if (result.status === 'blocked') {
      expect(result.reason).toBe('REPLAY_NOT_OWNER');
    }
  });

  it('blocks execution when no actor owns the session', () => {
    const result = checkReplaySessionOwnership(
      context({
        owner: 'NONE',
      }),
    );

    expect(result.status).toBe('blocked');

    if (result.status === 'blocked') {
      expect(result.reason).toBe('REPLAY_NOT_OWNER');
    }
  });

  it('maps ownership blocks to existing ACTION_FAILED taxonomy', () => {
    const result = checkReplaySessionOwnership(
      context({
        owner: 'DISCOVERY',
      }),
    );

    if (result.status !== 'blocked') {
      throw new Error('Expected blocked ownership result');
    }

    const failure = replayOwnershipFailure(result, 'open-accounts');

    expect(failure.code).toBe('ACTION_FAILED');

    expect(failure.details.reason).toBe('REPLAY_NOT_OWNER');
  });

  it('recognizes SessionManager ownership errors that must prevent browser actions', () => {
    expect(isReplayOwnershipError('OWNERSHIP_CONFLICT')).toBe(true);

    expect(isReplayOwnershipError('OWNERSHIP_MISMATCH')).toBe(true);

    expect(isReplayOwnershipError('HUMAN_CONTROL_ACTIVE')).toBe(true);
  });

  it('does not classify unrelated session failures as ownership errors', () => {
    expect(isReplayOwnershipError('RESOURCE_UNAVAILABLE')).toBe(false);

    expect(isReplayOwnershipError('INVALID_STATE')).toBe(false);
  });
});
