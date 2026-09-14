import { describe, expect, it } from 'vitest';

import { parseAgentObservation, verifyDiscoveryGoalCompletion } from '../../src/discovery/index.js';

import type { CompletionEvidenceState, DiscoveryCompletion } from '../../src/discovery/index.js';

const completion: DiscoveryCompletion = {
  kind: 'complete',
  summary: 'Read the Savings balance',
  outputs: {
    savingsBalance: '$12,840.50',
  },
};

const evidence: CompletionEvidenceState = {
  extractedValues: {
    savingsBalance: '$12,840.50',
  },

  extractions: [
    {
      outputName: 'savingsBalance',
      value: '$12,840.50',
      source: 'surface_read',
      step: 3,
      observationId: 'observation-3',
      actionId: 'action-3',
    },
  ],
};

function finalObservation(visibleTextSummary: string) {
  return parseAgentObservation({
    goal: "Read Alex Morgan's Savings balance",
    step: 4,

    observationId: 'observation-4',
    capturedAt: '2026-09-12T18:00:00.000Z',

    location: {
      kind: 'web',
      url: 'https://bank.test/member/alex/accounts',
      title: 'Alex Morgan Accounts',
    },

    visibleTextSummary,

    controls: [],
    dialogs: [],

    contextHints: {
      frames: [],
      regions: ['Accounts table'],
    },

    loading: 'complete',

    truncated: {
      visibleText: false,
      controls: false,
    },

    extractedValues: {
      savingsBalance: '$12,840.50',
    },

    recentAction: null,
    recentCondition: null,
    recentError: null,
  });
}

describe('discovery goal completion verification', () => {
  it('verifies a read-backed Savings balance supported by the final observation', () => {
    expect(
      verifyDiscoveryGoalCompletion({
        completion,
        evidence,
        finalObservation: finalObservation('Accounts\nSavings\nCurrent Balance\n$12,840.50'),
      }),
    ).toMatchObject({
      status: 'verified',
      outputs: {
        savingsBalance: '$12,840.50',
      },
    });
  });

  it('rejects completion when the final observation does not show the extracted value', () => {
    expect(
      verifyDiscoveryGoalCompletion({
        completion,
        evidence,
        finalObservation: finalObservation('Accounts\nSavings\nCurrent Balance'),
      }),
    ).toMatchObject({
      status: 'rejected',
      issues: [
        {
          code: 'FINAL_OBSERVATION_VALUE_MISSING',
        },
      ],
    });
  });

  it('rejects completion when final observation lacks Savings context', () => {
    expect(
      verifyDiscoveryGoalCompletion({
        completion,
        evidence,
        finalObservation: finalObservation('Available amount\n$12,840.50'),
      }),
    ).toMatchObject({
      status: 'rejected',
      issues: [
        {
          code: 'FINAL_OBSERVATION_CONTEXT_MISMATCH',
        },
      ],
    });
  });
});
