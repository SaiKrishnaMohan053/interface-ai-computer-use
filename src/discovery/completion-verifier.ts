import { isDeepStrictEqual } from 'node:util';

import type { JsonValue } from '../surface/index.js';

import type { DiscoveryCompletion } from './decision.js';

import type { DiscoveryExtractionRecord } from './run-state.js';

export const COMPLETION_REJECTION_CODES = [
  'NO_OUTPUTS_CLAIMED',
  'OUTPUT_NOT_EXTRACTED',
  'OUTPUT_VALUE_MISMATCH',
  'OUTPUT_READ_PROVENANCE_MISSING',
] as const;

export type CompletionRejectionCode = (typeof COMPLETION_REJECTION_CODES)[number];

export interface CompletionEvidenceState {
  readonly extractedValues: Readonly<Record<string, JsonValue>>;

  readonly extractions: readonly DiscoveryExtractionRecord[];
}

export interface CompletionVerificationIssue {
  readonly code: CompletionRejectionCode;
  readonly outputName: string | null;
  readonly message: string;
  readonly expected: JsonValue;
  readonly observed: JsonValue;
}

export type CompletionVerificationResult =
  | {
      readonly status: 'verified';
      readonly summary: string;

      /**
       * Authoritative values copied from discovery
       * working state, not from the model claim.
       */
      readonly outputs: Readonly<Record<string, JsonValue>>;
    }
  | {
      readonly status: 'rejected';
      readonly issues: readonly CompletionVerificationIssue[];
    };

function hasOutput(values: Readonly<Record<string, JsonValue>>, outputName: string): boolean {
  return Object.prototype.hasOwnProperty.call(values, outputName);
}

/**
 * Verifies semantic support for a structurally valid
 * complete decision.
 *
 * A model claim is accepted only when every claimed
 * output:
 *
 * 1. exists in discovery working state,
 * 2. exactly matches the extracted value, and
 * 3. has provenance from a successful surface read.
 *
 * This validates one discovery result only. It does not
 * define a capability artifact output contract.
 */
export function verifyDiscoveryCompletion(
  completion: DiscoveryCompletion,
  evidence: CompletionEvidenceState,
): CompletionVerificationResult {
  const claimedOutputs = Object.entries(completion.outputs);

  if (claimedOutputs.length === 0) {
    return {
      status: 'rejected',

      issues: [
        {
          code: 'NO_OUTPUTS_CLAIMED',
          outputName: null,

          message: 'Completion requires at least one read-backed discovery output',

          expected: 'at least one successful surface read',

          observed: {},
        },
      ],
    };
  }

  const issues: CompletionVerificationIssue[] = [];

  const verifiedOutputs: Record<string, JsonValue> = {};

  for (const [outputName, claimedValue] of claimedOutputs) {
    if (!hasOutput(evidence.extractedValues, outputName)) {
      issues.push({
        code: 'OUTPUT_NOT_EXTRACTED',
        outputName,

        message: `Completion output ${outputName} was not extracted during this run`,

        expected: 'successful surface read',

        observed: claimedValue,
      });

      continue;
    }

    const extractedValue = evidence.extractedValues[outputName];

    /*
     * JsonValue cannot contain undefined. This check
     * also protects the runtime boundary if an invalid
     * state object is supplied from JavaScript.
     */
    if (extractedValue === undefined) {
      issues.push({
        code: 'OUTPUT_NOT_EXTRACTED',
        outputName,

        message: `Completion output ${outputName} has no valid extracted value`,

        expected: 'successful surface read',

        observed: claimedValue,
      });

      continue;
    }

    if (!isDeepStrictEqual(claimedValue, extractedValue)) {
      issues.push({
        code: 'OUTPUT_VALUE_MISMATCH',
        outputName,

        message: `Completion output ${outputName} does not match the extracted value`,

        expected: extractedValue,
        observed: claimedValue,
      });

      continue;
    }

    const hasReadProvenance = evidence.extractions.some(
      (extraction) =>
        extraction.source === 'surface_read' &&
        extraction.outputName === outputName &&
        isDeepStrictEqual(extraction.value, extractedValue),
    );

    if (!hasReadProvenance) {
      issues.push({
        code: 'OUTPUT_READ_PROVENANCE_MISSING',

        outputName,

        message: `Completion output ${outputName} is not supported by a recorded surface read`,

        expected: 'matching surface_read provenance',

        observed: extractedValue,
      });

      continue;
    }

    /*
     * Return the runtime-extracted value rather than
     * trusting the model-provided copy.
     */
    verifiedOutputs[outputName] = extractedValue;
  }

  if (issues.length > 0) {
    return {
      status: 'rejected',
      issues: Object.freeze([...issues]),
    };
  }

  return {
    status: 'verified',
    summary: completion.summary,

    outputs: Object.freeze({
      ...verifiedOutputs,
    }),
  };
}
