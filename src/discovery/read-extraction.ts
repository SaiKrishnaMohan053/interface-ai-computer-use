import type { ActionResult, JsonValue, SurfaceFailure } from '../surface/index.js';

import type { DiscoveryDecision } from './decision.js';
import type { DiscoveryExtractionRecord } from './run-state.js';

export type DiscoveryReadDecision = Extract<DiscoveryDecision, { readonly kind: 'read' }>;
export type SuccessfulActionResult = Extract<ActionResult, { readonly status: 'success' }>;

export type DiscoveryReadExtractionResult =
  | {
      readonly status: 'extracted';
      readonly record: DiscoveryExtractionRecord;
    }
  | {
      readonly status: 'rejected';
      readonly error: SurfaceFailure;
    };

export interface ExtractDiscoveryReadInput {
  readonly decision: DiscoveryReadDecision;
  readonly result: SuccessfulActionResult;
  readonly step: number;
  readonly observationId: string;
}

/**
 * Converts a successful runtime read into discovery-only working output.
 *
 * The adapter must return a read payload from the requested source. A generic
 * successful action or a payload from a different source is not extraction
 * evidence and is rejected instead of being silently trusted.
 */
export function extractDiscoveryRead(
  input: ExtractDiscoveryReadInput,
): DiscoveryReadExtractionResult {
  const { decision, result } = input;

  if (result.output.kind !== 'read') {
    return {
      status: 'rejected',
      error: {
        code: 'ACTION_FAILED',
        message: `Read action did not return a value for ${decision.saveAs}`,
        expected: { kind: 'read', source: decision.source },
        observed: result.output,
      },
    };
  }

  if (result.output.source !== decision.source) {
    return {
      status: 'rejected',
      error: {
        code: 'ACTION_FAILED',
        message: `Read action returned an unexpected source for ${decision.saveAs}`,
        expected: decision.source,
        observed: result.output.source,
      },
    };
  }

  return {
    status: 'extracted',
    record: {
      outputName: decision.saveAs,
      value: result.output.value,
      source: 'surface_read',
      step: input.step,
      observationId: input.observationId,
      actionId: result.actionId,
    },
  };
}

/**
 * Retains the latest successful value under saveAs and appends provenance for
 * every successful read. This state belongs to the discovery run only.
 */
export function retainDiscoveryExtraction(
  state: {
    readonly extractedValues: Record<string, JsonValue>;
    readonly extractions: DiscoveryExtractionRecord[];
  },
  record: DiscoveryExtractionRecord,
): void {
  state.extractedValues[record.outputName] = record.value;
  state.extractions.push(record);
}
