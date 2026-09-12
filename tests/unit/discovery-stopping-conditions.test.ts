import { describe, expect, it } from 'vitest';

import {
  evaluateDiscoveryLoopBudget,
  isHardDiscoveryActionFailure,
} from '../../src/discovery/index.js';

import type { SurfaceFailure, SurfaceFailureCode } from '../../src/surface/index.js';

const DEADLINE = '2026-09-12T12:02:00.000Z';

function failure(code: SurfaceFailureCode): SurfaceFailure {
  return {
    code,
    message: code,
    expected: 'successful action',
    observed: code,
  };
}

describe('discovery stopping conditions', () => {
  it('continues while step and time budgets remain', () => {
    expect(
      evaluateDiscoveryLoopBudget({
        step: 3,
        maxSteps: 20,
        nowMs: Date.parse('2026-09-12T12:01:00.000Z'),
        deadlineAt: DEADLINE,
        aborted: false,
      }),
    ).toBeNull();
  });

  it('stops an explicitly cancelled run', () => {
    expect(
      evaluateDiscoveryLoopBudget({
        step: 0,
        maxSteps: 20,
        nowMs: Date.parse('2026-09-12T12:01:00.000Z'),
        deadlineAt: DEADLINE,
        aborted: true,
      }),
    ).toBe('cancelled');
  });

  it('stops at the run deadline', () => {
    expect(
      evaluateDiscoveryLoopBudget({
        step: 3,
        maxSteps: 20,
        nowMs: Date.parse(DEADLINE),
        deadlineAt: DEADLINE,
        aborted: false,
      }),
    ).toBe('run_timeout');
  });

  it('stops before requesting a decision beyond maxSteps', () => {
    expect(
      evaluateDiscoveryLoopBudget({
        step: 20,
        maxSteps: 20,
        nowMs: Date.parse('2026-09-12T12:01:00.000Z'),
        deadlineAt: DEADLINE,
        aborted: false,
      }),
    ).toBe('max_steps');
  });

  it.each([
    'ACTION_FAILED',
    'NAVIGATION_FAILED',
    'SURFACE_UNAVAILABLE',
    'UNSUPPORTED_OPERATION',
  ] as const)('classifies %s as a hard action failure', (code) => {
    expect(isHardDiscoveryActionFailure(failure(code))).toBe(true);
  });

  it.each(['TARGET_NOT_FOUND', 'TARGET_AMBIGUOUS', 'STALE_TARGET'] as const)(
    'does not classify %s as a hard action failure',
    (code) => {
      expect(isHardDiscoveryActionFailure(failure(code))).toBe(false);
    },
  );
});
