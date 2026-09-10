import { describe, expect, it } from 'vitest';
import {
  BUSINESS_OUTCOME_CODES,
  RECOVERABLE_CONDITION_CODES,
  RUNTIME_FAILURE_CODES,
  parseRecoverableCondition,
  parseRuntimeResult,
  runtimeResultSchema,
} from '../../src/runtime/index.js';

const base = {
  runId: 'run-1',
  sessionId: 'session-1',
  startedAt: '2026-09-10T10:00:00.000Z',
  finishedAt: '2026-09-10T10:00:01.000Z',
  durationMs: 1000,
  evidenceRefs: [],
  recoverableConditions: [],
};

describe('runtime result contracts', () => {
  it('accepts success with typed outputs', () => {
    expect(
      parseRuntimeResult({
        ...base,
        status: 'success',
        outputs: {
          memberName: 'Alex Morgan',
          currentBalance: '$12,840.50',
        },
      }),
    ).toMatchObject({
      status: 'success',
    });
  });

  it.each(BUSINESS_OUTCOME_CODES)('accepts business outcome %s', (code) => {
    expect(
      parseRuntimeResult({
        ...base,
        status: 'business_outcome',
        outcome: {
          code,
          message: `Observed ${code}`,
          details: {},
        },
      }),
    ).toMatchObject({
      status: 'business_outcome',
      outcome: {
        code,
      },
    });
  });

  it('accepts an intervention request for HUMAN ownership', () => {
    expect(
      parseRuntimeResult({
        ...base,
        status: 'intervention_required',
        intervention: {
          interventionId: 'intervention-1',
          code: 'HUMAN_APPROVAL_REQUIRED',
          message: 'A human must approve the next step',
          requestedOwner: 'HUMAN',
          resumable: true,
          context: {
            stepId: 'step-3',
          },
        },
      }),
    ).toMatchObject({
      status: 'intervention_required',
      intervention: {
        requestedOwner: 'HUMAN',
      },
    });
  });

  it.each(RUNTIME_FAILURE_CODES)('accepts failure %s', (code) => {
    expect(
      parseRuntimeResult({
        ...base,
        status: 'failure',
        error: {
          code,
          message: `Runtime failed with ${code}`,
          stepId: 'step-1',
          expected: 'expected state',
          observed: 'observed state',
          details: {},
        },
      }),
    ).toMatchObject({
      status: 'failure',
      error: {
        code,
      },
    });
  });

  it('defines recoverable conditions as internal non-terminal events', () => {
    const conditions = [
      {
        code: 'TRANSIENT_LOAD',
        message: 'Page is still loading',
        detectedAt: '2026-09-10T10:00:00.000Z',
        details: {},
        recovery: 'wait-and-retry',
        attempt: 1,
        maxAttempts: 3,
      },
      {
        code: 'KNOWN_DIALOG',
        message: 'Known confirmation dialog detected',
        detectedAt: '2026-09-10T10:00:00.000Z',
        details: {},
        recovery: 'dismiss',
        dialogId: 'dialog-1',
      },
      {
        code: 'KNOWN_INTERSTITIAL',
        message: 'Known service interstitial detected',
        detectedAt: '2026-09-10T10:00:00.000Z',
        details: {},
        recovery: 'continue',
        dialogId: 'interstitial-1',
      },
    ] as const;

    expect(conditions.map(parseRecoverableCondition).map((condition) => condition.code)).toEqual(
      RECOVERABLE_CONDITION_CODES,
    );
  });

  it('keeps business, recoverable and failure codes in separate categories', () => {
    expect(
      runtimeResultSchema.safeParse({
        ...base,
        status: 'failure',
        error: {
          code: 'TRANSIENT_LOAD',
          message: 'Incorrect terminal classification',
          stepId: null,
          expected: null,
          observed: null,
          details: {},
        },
      }).success,
    ).toBe(false);

    expect(
      runtimeResultSchema.safeParse({
        ...base,
        status: 'business_outcome',
        outcome: {
          code: 'APPLICATION_ERROR',
          message: 'Incorrect business classification',
          details: {},
        },
      }).success,
    ).toBe(false);
  });

  it('rejects invalid chronology and unknown result fields', () => {
    expect(
      runtimeResultSchema.safeParse({
        ...base,
        startedAt: '2026-09-10T10:00:02.000Z',
        status: 'success',
        outputs: {},
      }).success,
    ).toBe(false);

    expect(
      runtimeResultSchema.safeParse({
        ...base,
        status: 'success',
        outputs: {},
        classifierGuess: 'not-allowed',
      }).success,
    ).toBe(false);
  });
});
