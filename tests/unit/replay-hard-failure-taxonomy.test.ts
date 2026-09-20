import { describe, expect, it } from 'vitest';

import {
  BUSINESS_OUTCOME_CODES,
  INTERVENTION_REASON_CODES,
  RUNTIME_FAILURE_CODES,
  runtimeResultSchema,
} from '../../src/runtime/index.js';

describe('replay hard failure taxonomy', () => {
  it('keeps permission denied as a business outcome rather than a runtime failure', () => {
    expect(BUSINESS_OUTCOME_CODES).toContain('PERMISSION_DENIED');

    expect(RUNTIME_FAILURE_CODES).not.toContain('PERMISSION_DENIED' as never);
  });

  it.each([
    'SESSION_EXPIRED_UNRECOVERABLE',
    'APPLICATION_ERROR',
    'TARGET_NOT_FOUND',
    'TARGET_AMBIGUOUS',
    'CHECKPOINT_FAILED',
    'OUTPUT_EXTRACTION_FAILED',
    'ACTION_FAILED',
    'RUN_TIMEOUT',
  ] as const)('keeps %s as a canonical runtime failure', (code) => {
    expect(RUNTIME_FAILURE_CODES).toContain(code);
  });

  it('keeps output extraction failure distinct from generic action failure', () => {
    expect(RUNTIME_FAILURE_CODES).toContain('OUTPUT_EXTRACTION_FAILED');

    expect(RUNTIME_FAILURE_CODES).toContain('ACTION_FAILED');
  });

  it('keeps recovery exhaustion as intervention rather than hard runtime failure', () => {
    expect(INTERVENTION_REASON_CODES).toContain('RECOVERY_EXHAUSTED');

    expect(RUNTIME_FAILURE_CODES).not.toContain('RECOVERY_EXHAUSTED' as never);
  });

  it('accepts permission denied as a business_outcome RuntimeResult', () => {
    const result = runtimeResultSchema.parse({
      runId: 'run-1',

      sessionId: 'session-1',

      startedAt: '2026-09-20T22:00:00.000Z',

      finishedAt: '2026-09-20T22:00:01.000Z',

      durationMs: 1_000,

      evidenceRefs: [],

      recoverableConditions: [],

      status: 'business_outcome',

      outcome: {
        code: 'PERMISSION_DENIED',

        message: 'Permission denied.',

        details: {},
      },
    });

    expect(result.status).toBe('business_outcome');
  });

  it.each([
    'SESSION_EXPIRED_UNRECOVERABLE',
    'APPLICATION_ERROR',
    'TARGET_NOT_FOUND',
    'TARGET_AMBIGUOUS',
    'CHECKPOINT_FAILED',
    'OUTPUT_EXTRACTION_FAILED',
    'ACTION_FAILED',
    'RUN_TIMEOUT',
  ] as const)('accepts %s as a typed failure RuntimeResult', (code) => {
    const result = runtimeResultSchema.parse({
      runId: 'run-1',

      sessionId: 'session-1',

      startedAt: '2026-09-20T22:00:00.000Z',

      finishedAt: '2026-09-20T22:00:01.000Z',

      durationMs: 1_000,

      evidenceRefs: [],

      recoverableConditions: [],

      status: 'failure',

      error: {
        code,

        message: `${code} replay failure.`,

        stepId: null,

        expected: null,

        observed: null,

        details: {},
      },
    });

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe(code);
    }
  });
});
