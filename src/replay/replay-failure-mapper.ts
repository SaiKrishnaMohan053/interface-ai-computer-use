import type { RuntimeFailureCode } from '../runtime/index.js';

import type { JsonValue, SurfaceFailure } from '../surface/index.js';

export type ReplayFailurePhase =
  'navigation' | 'action' | 'target_resolution' | 'checkpoint' | 'output_extraction';

export interface ReplayMappedFailure {
  readonly code: RuntimeFailureCode;
  readonly message: string;
  readonly expected: JsonValue;
  readonly observed: JsonValue;

  readonly details: Readonly<Record<string, JsonValue>>;
}

export interface ReplayFailureMappingInput {
  readonly phase: ReplayFailurePhase;

  readonly stepId: string;

  readonly failure: SurfaceFailure;
}

function baseDetails(input: ReplayFailureMappingInput): Readonly<Record<string, JsonValue>> {
  return {
    stepId: input.stepId,
    phase: input.phase,
    surfaceFailureCode: input.failure.code,
  };
}

function canonicalTargetFailure(input: ReplayFailureMappingInput): ReplayMappedFailure {
  if (input.failure.code === 'TARGET_NOT_FOUND') {
    return {
      code: 'TARGET_NOT_FOUND',

      message: input.failure.message,

      expected: input.failure.expected,

      observed: input.failure.observed,

      details: baseDetails(input),
    };
  }

  if (input.failure.code === 'TARGET_AMBIGUOUS') {
    return {
      code: 'TARGET_AMBIGUOUS',

      message: input.failure.message,

      expected: input.failure.expected,

      observed: input.failure.observed,

      details: baseDetails(input),
    };
  }

  return {
    code: 'ACTION_FAILED',

    message: input.failure.message,

    expected: input.failure.expected,

    observed: input.failure.observed,

    details: {
      ...baseDetails(input),

      reason: 'TARGET_RESOLUTION_FAILURE',
    },
  };
}

export function mapReplayFailure(input: ReplayFailureMappingInput): ReplayMappedFailure {
  switch (input.phase) {
    case 'navigation':
      return {
        code: 'NAVIGATION_FAILED',

        message: input.failure.message,

        expected: input.failure.expected,

        observed: input.failure.observed,

        details: baseDetails(input),
      };

    case 'action':
      return {
        code: 'ACTION_FAILED',

        message: input.failure.message,

        expected: input.failure.expected,

        observed: input.failure.observed,

        details: baseDetails(input),
      };

    case 'target_resolution':
      return canonicalTargetFailure(input);

    case 'checkpoint':
      return {
        code: 'CHECKPOINT_FAILED',

        message: input.failure.message,

        expected: input.failure.expected,

        observed: input.failure.observed,

        details: baseDetails(input),
      };

    case 'output_extraction':
      return {
        /*
         * OUTPUT_EXTRACTION_FAILED is not a
         * canonical RuntimeFailureCode.
         *
         * Extraction belongs to execution of a
         * read action, therefore ACTION_FAILED
         * remains the public failure code.
         */
        code: 'ACTION_FAILED',

        message: input.failure.message,

        expected: input.failure.expected,

        observed: input.failure.observed,

        details: {
          ...baseDetails(input),

          reason: 'OUTPUT_EXTRACTION_FAILED',
        },
      };
  }
}
