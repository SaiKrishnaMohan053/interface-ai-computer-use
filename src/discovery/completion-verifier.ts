import { isDeepStrictEqual } from 'node:util';

import type { JsonValue } from '../surface/index.js';

import type { AgentObservation } from './agent-observation.js';
import type { DiscoveryCompletion } from './decision.js';
import type { DiscoveryExtractionRecord } from './run-state.js';

export const COMPLETION_REJECTION_CODES = [
  'NO_OUTPUTS_CLAIMED',
  'OUTPUT_NOT_EXTRACTED',
  'OUTPUT_VALUE_MISMATCH',
  'OUTPUT_READ_PROVENANCE_MISSING',
  'FINAL_OBSERVATION_VALUE_MISSING',
  'FINAL_OBSERVATION_CONTEXT_MISMATCH',
] as const;

export type CompletionRejectionCode = (typeof COMPLETION_REJECTION_CODES)[number];

export interface CompletionEvidenceState {
  readonly extractedValues: Readonly<Record<string, JsonValue>>;

  readonly extractions: readonly DiscoveryExtractionRecord[];
}

export interface GoalCompletionVerificationInput {
  readonly completion: DiscoveryCompletion;
  readonly evidence: CompletionEvidenceState;
  readonly finalObservation: AgentObservation;
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

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US');
}

function observationText(observation: AgentObservation): string {
  const title =
    observation.location.kind === 'web'
      ? observation.location.title
      : observation.location.windowTitle;

  return normalizeText(`${title}\n${observation.visibleTextSummary}`);
}

function visibleScalar(value: JsonValue): string | null {
  switch (typeof value) {
    case 'string':
      return normalizeText(value);

    case 'number':
    case 'boolean':
      return normalizeText(String(value));

    default:
      return null;
  }
}

/**
 * Minimal Phase 2 capability-specific verification.
 *
 * This validates only the Savings balance discovery
 * result. It is not a reusable artifact checkpoint.
 */
function verifySavingsBalanceObservation(
  outputName: string,
  extractedValue: JsonValue,
  finalObservation: AgentObservation,
): CompletionVerificationIssue[] {
  if (outputName !== 'savingsBalance') {
    return [];
  }

  const text = observationText(finalObservation);
  const valueText = visibleScalar(extractedValue);
  const issues: CompletionVerificationIssue[] = [];

  if (valueText === null || !text.includes(valueText)) {
    issues.push({
      code: 'FINAL_OBSERVATION_VALUE_MISSING',
      outputName,
      message: 'Final observation does not visibly support the extracted Savings balance',
      expected: extractedValue,
      observed: finalObservation.visibleTextSummary,
    });
  }

  if (!text.includes('savings') || !text.includes('balance')) {
    issues.push({
      code: 'FINAL_OBSERVATION_CONTEXT_MISMATCH',
      outputName,
      message: 'Final observation is not compatible with the Savings balance context',
      expected: 'visible Savings and balance context',
      observed: finalObservation.visibleTextSummary,
    });
  }

  return issues;
}

/**
 * Generic discovery-run verification.
 *
 * Every claimed output must:
 *
 * 1. exist in discovery working state,
 * 2. exactly match the extracted value,
 * 3. have successful surface-read provenance.
 *
 * This does not define an artifact output contract.
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
     * Runtime-extracted value is authoritative.
     * The model-provided copy is never returned.
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

/**
 * Composes generic read verification with the minimal
 * capability-specific final observation check.
 *
 * This is discovery-run completion validation only.
 */
export function verifyDiscoveryGoalCompletion(
  input: GoalCompletionVerificationInput,
): CompletionVerificationResult {
  const readVerification = verifyDiscoveryCompletion(input.completion, input.evidence);

  if (readVerification.status === 'rejected') {
    return readVerification;
  }

  const issues = Object.entries(readVerification.outputs).flatMap(([outputName, value]) =>
    verifySavingsBalanceObservation(outputName, value, input.finalObservation),
  );

  if (issues.length > 0) {
    return {
      status: 'rejected',
      issues: Object.freeze(issues),
    };
  }

  return readVerification;
}
