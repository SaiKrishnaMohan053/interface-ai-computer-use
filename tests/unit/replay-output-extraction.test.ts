import { describe, expect, it } from 'vitest';

import { extractReplayOutput } from '../../src/replay/index.js';

import type { ActionResult } from '../../src/surface/index.js';

const scope = {
  sessionId: 'replay-session',
  surfaceId: 'replay-surface',
} as const;

function readSuccess(value: string): ActionResult {
  return {
    ...scope,

    actionId: 'read-savings-balance',

    startedAt: '2026-09-20T21:00:00.000Z',

    finishedAt: '2026-09-20T21:00:00.001Z',

    durationMs: 1,

    evidenceRefs: [],

    status: 'success',

    output: {
      kind: 'read',
      source: 'text',
      value,
    },
  };
}

function noOutputSuccess(): ActionResult {
  return {
    ...scope,

    actionId: 'read-savings-balance',

    startedAt: '2026-09-20T21:00:00.000Z',

    finishedAt: '2026-09-20T21:00:00.001Z',

    durationMs: 1,

    evidenceRefs: [],

    status: 'success',

    output: {
      kind: 'none',
    },
  };
}

function actionFailure(): ActionResult {
  return {
    ...scope,

    actionId: 'read-savings-balance',

    startedAt: '2026-09-20T21:00:00.000Z',

    finishedAt: '2026-09-20T21:00:00.001Z',

    durationMs: 1,

    evidenceRefs: [],

    status: 'failure',

    error: {
      code: 'ACTION_FAILED',

      message: 'Read operation failed.',

      expected: 'read value',
      observed: null,
    },
  };
}

describe('replay output extraction', () => {
  it('extracts a valid read value', () => {
    const result = extractReplayOutput({
      stepId: 'read-savings-balance',

      outputName: 'savingsBalance',

      actionResult: readSuccess('$12,840.50'),
    });

    expect(result).toEqual({
      status: 'success',
      value: '$12,840.50',
    });
  });

  it('does not produce undefined inside a success result', () => {
    const result = extractReplayOutput({
      stepId: 'read-savings-balance',

      outputName: 'savingsBalance',

      actionResult: noOutputSuccess(),
    });

    expect(result.status).toBe('failure');

    expect('value' in result).toBe(false);
  });

  it('fails when a successful action produced no read output', () => {
    const result = extractReplayOutput({
      stepId: 'read-savings-balance',

      outputName: 'savingsBalance',

      actionResult: noOutputSuccess(),
    });

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('ACTION_FAILED');

      expect(result.error.details.reason).toBe('OUTPUT_EXTRACTION_FAILED');
    }
  });

  it('fails when the read value is empty', () => {
    const result = extractReplayOutput({
      stepId: 'read-savings-balance',

      outputName: 'savingsBalance',

      actionResult: readSuccess(''),
    });

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.details.reason).toBe('OUTPUT_EXTRACTION_FAILED');
    }
  });

  it('fails when the read value contains only whitespace', () => {
    const result = extractReplayOutput({
      stepId: 'read-savings-balance',

      outputName: 'savingsBalance',

      actionResult: readSuccess('   '),
    });

    expect(result.status).toBe('failure');
  });

  it('fails when the underlying read action failed', () => {
    const result = extractReplayOutput({
      stepId: 'read-savings-balance',

      outputName: 'savingsBalance',

      actionResult: actionFailure(),
    });

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('ACTION_FAILED');

      expect(result.error.details.reason).toBe('OUTPUT_EXTRACTION_FAILED');

      expect(result.error.details.stepId).toBe('read-savings-balance');

      expect(result.error.details.outputName).toBe('savingsBalance');
    }
  });

  it('preserves the exact extracted text without inventing or normalizing a value', () => {
    const value = '$12,840.50';

    const result = extractReplayOutput({
      stepId: 'read-savings-balance',

      outputName: 'savingsBalance',

      actionResult: readSuccess(value),
    });

    expect(result.status).toBe('success');

    if (result.status === 'success') {
      expect(result.value).toBe(value);
    }
  });
});
