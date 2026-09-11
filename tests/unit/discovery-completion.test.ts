import { describe, expect, it } from 'vitest';

import { verifyDiscoveryCompletion } from '../../src/discovery/index.js';

import type { CompletionEvidenceState, DiscoveryCompletion } from '../../src/discovery/index.js';

const completion: DiscoveryCompletion = {
  kind: 'complete',

  summary: "Located Alex Morgan's Savings account and read the current balance.",

  outputs: {
    savingsBalance: '$12,840.50',
  },
};

const verifiedEvidence: CompletionEvidenceState = {
  extractedValues: {
    savingsBalance: '$12,840.50',
  },

  extractions: [
    {
      outputName: 'savingsBalance',

      value: '$12,840.50',

      source: 'surface_read',

      step: 5,

      observationId: 'observation-5',

      actionId: 'action-5',
    },
  ],
};

describe('discovery completion verification', () => {
  it('verifies a completion backed by a successful surface read', () => {
    expect(verifyDiscoveryCompletion(completion, verifiedEvidence)).toEqual({
      status: 'verified',

      summary: "Located Alex Morgan's Savings account and read the current balance.",

      outputs: {
        savingsBalance: '$12,840.50',
      },
    });
  });

  it('returns the authoritative extracted value', () => {
    const result = verifyDiscoveryCompletion(completion, verifiedEvidence);

    expect(result.status).toBe('verified');

    if (result.status === 'verified') {
      expect(result.outputs.savingsBalance).toBe(verifiedEvidence.extractedValues.savingsBalance);
    }
  });

  it('rejects completion with no claimed outputs', () => {
    const result = verifyDiscoveryCompletion(
      {
        kind: 'complete',
        summary: 'Claimed completion without a result',
        outputs: {},
      },
      {
        extractedValues: {},
        extractions: [],
      },
    );

    expect(result).toMatchObject({
      status: 'rejected',

      issues: [
        {
          code: 'NO_OUTPUTS_CLAIMED',

          outputName: null,
        },
      ],
    });
  });

  it('rejects an output that was never extracted', () => {
    const result = verifyDiscoveryCompletion(completion, {
      extractedValues: {},
      extractions: [],
    });

    expect(result).toMatchObject({
      status: 'rejected',

      issues: [
        {
          code: 'OUTPUT_NOT_EXTRACTED',

          outputName: 'savingsBalance',
        },
      ],
    });
  });

  it('rejects a model value that differs from the extracted value', () => {
    const result = verifyDiscoveryCompletion(
      {
        ...completion,

        outputs: {
          savingsBalance: '$99,999.99',
        },
      },
      verifiedEvidence,
    );

    expect(result).toMatchObject({
      status: 'rejected',

      issues: [
        {
          code: 'OUTPUT_VALUE_MISMATCH',

          outputName: 'savingsBalance',

          expected: '$12,840.50',

          observed: '$99,999.99',
        },
      ],
    });
  });

  it('rejects an extracted value without read provenance', () => {
    const result = verifyDiscoveryCompletion(completion, {
      extractedValues: {
        savingsBalance: '$12,840.50',
      },

      extractions: [],
    });

    expect(result).toMatchObject({
      status: 'rejected',

      issues: [
        {
          code: 'OUTPUT_READ_PROVENANCE_MISSING',

          outputName: 'savingsBalance',
        },
      ],
    });
  });

  it('rejects provenance for a different value', () => {
    const result = verifyDiscoveryCompletion(completion, {
      extractedValues: {
        savingsBalance: '$12,840.50',
      },

      extractions: [
        {
          outputName: 'savingsBalance',

          value: '$10.00',

          source: 'surface_read',

          step: 4,

          observationId: 'observation-4',

          actionId: 'action-4',
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'rejected',

      issues: [
        {
          code: 'OUTPUT_READ_PROVENANCE_MISSING',
        },
      ],
    });
  });

  it('verifies multiple independently read outputs', () => {
    const result = verifyDiscoveryCompletion(
      {
        kind: 'complete',

        summary: 'Read the requested account details.',

        outputs: {
          accountType: 'Savings',

          savingsBalance: '$12,840.50',
        },
      },
      {
        extractedValues: {
          accountType: 'Savings',

          savingsBalance: '$12,840.50',
        },

        extractions: [
          {
            outputName: 'accountType',

            value: 'Savings',

            source: 'surface_read',

            step: 4,

            observationId: 'observation-4',

            actionId: 'action-4',
          },
          {
            outputName: 'savingsBalance',

            value: '$12,840.50',

            source: 'surface_read',

            step: 5,

            observationId: 'observation-5',

            actionId: 'action-5',
          },
        ],
      },
    );

    expect(result).toMatchObject({
      status: 'verified',

      outputs: {
        accountType: 'Savings',

        savingsBalance: '$12,840.50',
      },
    });
  });
});
