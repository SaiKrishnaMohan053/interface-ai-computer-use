import { describe, expect, it } from 'vitest';

import { extractDiscoveryRead, retainDiscoveryExtraction } from '../../src/discovery/index.js';
import type { DiscoveryReadDecision } from '../../src/discovery/index.js';
import type { ActionResult } from '../../src/surface/index.js';

const decision: DiscoveryReadDecision = {
  kind: 'read',
  target: {
    description: 'Current Balance for Savings account',
    strategies: [
      {
        kind: 'structural',
        query: {
          kind: 'table-cell',
          table: {
            name: { value: 'Accounts', mode: 'exact', caseSensitive: false },
          },
          row: {
            columnHeader: {
              value: 'Account Type',
              mode: 'exact',
              caseSensitive: false,
            },
            value: { value: 'Savings', mode: 'exact', caseSensitive: false },
          },
          column: {
            header: {
              value: 'Current Balance',
              mode: 'exact',
              caseSensitive: false,
            },
          },
        },
      },
    ],
    cardinality: 'exactly-one',
  },
  source: 'text',
  saveAs: 'savingsBalance',
  reason: 'Read the requested balance',
};

function success(
  output: Extract<ActionResult, { readonly status: 'success' }>['output'],
): Extract<ActionResult, { readonly status: 'success' }> {
  return {
    sessionId: 'session-1',
    surfaceId: 'surface-1',
    actionId: 'action-7',
    startedAt: '2026-09-11T17:00:00.000Z',
    finishedAt: '2026-09-11T17:00:00.010Z',
    durationMs: 10,
    evidenceRefs: [],
    status: 'success',
    output,
  };
}

describe('discovery read extraction', () => {
  it('creates surface-read provenance for the requested saveAs name', () => {
    expect(
      extractDiscoveryRead({
        decision,
        result: success({ kind: 'read', source: 'text', value: '$12,840.50' }),
        step: 7,
        observationId: 'observation-7',
      }),
    ).toEqual({
      status: 'extracted',
      record: {
        outputName: 'savingsBalance',
        value: '$12,840.50',
        source: 'surface_read',
        step: 7,
        observationId: 'observation-7',
        actionId: 'action-7',
      },
    });
  });

  it('rejects a nominally successful action without a read payload', () => {
    expect(
      extractDiscoveryRead({
        decision,
        result: success({ kind: 'none' }),
        step: 7,
        observationId: 'observation-7',
      }),
    ).toMatchObject({
      status: 'rejected',
      error: { code: 'ACTION_FAILED' },
    });
  });

  it('rejects output read from a different source than requested', () => {
    expect(
      extractDiscoveryRead({
        decision,
        result: success({ kind: 'read', source: 'value', value: '$12,840.50' }),
        step: 7,
        observationId: 'observation-7',
      }),
    ).toMatchObject({
      status: 'rejected',
      error: {
        code: 'ACTION_FAILED',
        expected: 'text',
        observed: 'value',
      },
    });
  });

  it('keeps the latest successful value and all read provenance in run state', () => {
    const state = {
      extractedValues: { savingsBalance: '$12,000.00' },
      extractions: [],
    };
    const extraction = extractDiscoveryRead({
      decision,
      result: success({ kind: 'read', source: 'text', value: '$12,840.50' }),
      step: 7,
      observationId: 'observation-7',
    });

    expect(extraction.status).toBe('extracted');
    if (extraction.status !== 'extracted') return;
    retainDiscoveryExtraction(state, extraction.record);

    expect(state.extractedValues).toEqual({ savingsBalance: '$12,840.50' });
    expect(state.extractions).toEqual([extraction.record]);
  });
});
