import type { RuntimeFailureCode } from '../runtime/index.js';

import type { ActionResult, JsonValue } from '../surface/index.js';

export interface ReplayOutputExtractionFailure {
  readonly status: 'failure';

  readonly error: {
    readonly code: RuntimeFailureCode;
    readonly message: string;
    readonly expected: JsonValue;
    readonly observed: JsonValue;

    readonly details: Readonly<Record<string, JsonValue>>;
  };
}

export interface ReplayOutputExtractionSuccess {
  readonly status: 'success';
  readonly value: string;
}

export type ReplayOutputExtractionResult =
  ReplayOutputExtractionSuccess | ReplayOutputExtractionFailure;

export interface ReplayOutputExtractionInput {
  readonly stepId: string;
  readonly outputName: string;
  readonly actionResult: ActionResult;
}

function extractionFailure(
  input: ReplayOutputExtractionInput,
  message: string,
  observed: JsonValue,
): ReplayOutputExtractionFailure {
  return {
    status: 'failure',

    error: {
      /*
       * OUTPUT_EXTRACTION_FAILED is intentionally
       * diagnostic metadata rather than a new public
       * RuntimeFailureCode.
       */
      code: 'ACTION_FAILED',

      message,

      expected: 'non-empty read output',

      observed,

      details: {
        stepId: input.stepId,
        outputName: input.outputName,
        phase: 'output_extraction',
        reason: 'OUTPUT_EXTRACTION_FAILED',
      },
    },
  };
}

/**
 * Extracts a reusable replay output from the result
 * of an artifact read action.
 *
 * This function never returns:
 *
 *   { status: 'success', value: undefined }
 *
 * A missing, non-read, or empty value fails closed.
 */
export function extractReplayOutput(
  input: ReplayOutputExtractionInput,
): ReplayOutputExtractionResult {
  if (input.actionResult.status === 'failure') {
    return extractionFailure(
      input,
      'Output extraction could not continue because the read action failed.',
      {
        actionStatus: 'failure',
        actionFailureCode: input.actionResult.error.code,
      },
    );
  }

  if (input.actionResult.output.kind !== 'read') {
    return extractionFailure(
      input,
      'Replay step completed without producing a readable output value.',
      {
        actionStatus: 'success',
        outputKind: input.actionResult.output.kind,
      },
    );
  }

  const value = input.actionResult.output.value;

  if (typeof value !== 'string' || value.trim().length === 0) {
    return extractionFailure(
      input,
      'Replay read action did not produce a valid non-empty output value.',
      {
        actionStatus: 'success',
        outputKind: 'read',
        value: typeof value === 'string' ? value : null,
      },
    );
  }

  return {
    status: 'success',
    value,
  };
}
