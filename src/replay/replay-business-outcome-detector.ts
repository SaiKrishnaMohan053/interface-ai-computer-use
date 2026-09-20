import { ConditionEvaluator } from '../conditions/index.js';

import type {
  CapabilityArtifact,
  WaitPolicy,
} from '../artifact/index.js';

import type {
  BusinessOutcomeCode,
} from '../runtime/index.js';

import {
  businessOutcomeCodeSchema,
} from '../runtime/index.js';

import type {
  EvidenceReference,
  JsonValue,
  SurfaceAdapter,
} from '../surface/index.js';

import type {
  TargetStrategy,
} from '../targeting/index.js';

export interface ReplayDetectedBusinessOutcome {
  readonly code: BusinessOutcomeCode;
  readonly message: string;
  readonly details: Readonly<Record<string, JsonValue>>;
}

export type ReplayBusinessOutcomeDetectionResult =
  | {
      readonly status: 'detected';
      readonly outcome: ReplayDetectedBusinessOutcome;
      readonly evidenceRefs: readonly EvidenceReference[];
    }
  | {
      readonly status: 'none';
      readonly evidenceRefs: readonly EvidenceReference[];
    }
  | {
      readonly status: 'failure';
      readonly error: {
        readonly code: 'CHECKPOINT_FAILED';
        readonly message: string;
        readonly expected: JsonValue;
        readonly observed: JsonValue;
        readonly details: Readonly<Record<string, JsonValue>>;
      };
      readonly evidenceRefs: readonly EvidenceReference[];
    };

export interface ReplayBusinessOutcomeDetectionInput {
  readonly adapter: SurfaceAdapter<TargetStrategy>;

  readonly artifact: Pick<
    CapabilityArtifact,
    'knownBusinessOutcomes'
  >;

  readonly wait: WaitPolicy;
  readonly signal?: AbortSignal;
}

/**
 * Evaluates artifact-declared business outcome detectors in persisted order.
 *
 * A matched detector is a normal domain result, not an exception.
 */
export async function detectReplayBusinessOutcome(
  input: ReplayBusinessOutcomeDetectionInput,
): Promise<ReplayBusinessOutcomeDetectionResult> {
  const declarations =
    input.artifact.knownBusinessOutcomes;

  if (
    declarations === undefined ||
    declarations.length === 0
  ) {
    return {
      status: 'none',
      evidenceRefs: [],
    };
  }

  const evaluator = new ConditionEvaluator(
    input.adapter,
  );

  const evidenceRefs: EvidenceReference[] = [];

  for (
    let index = 0;
    index < declarations.length;
    index += 1
  ) {
    const declaration = declarations[index];

    if (declaration === undefined) {
      continue;
    }

    const code =
      businessOutcomeCodeSchema.safeParse(
        declaration.code,
      );

    if (!code.success) {
      return {
        status: 'failure',
        error: {
          code: 'CHECKPOINT_FAILED',
          message:
            `Artifact business outcome "${declaration.code}" ` +
            'is not supported by the runtime result contract.',
          expected:
            'supported runtime business outcome code',
          observed: declaration.code,
          details: {
            phase: 'business_outcome_detection',
            reason:
              'UNSUPPORTED_BUSINESS_OUTCOME_CODE',
            detectorIndex: index,
          },
        },
        evidenceRefs,
      };
    }

    const conditionId =
      `business-outcome:${code.data}:${index}`;

    const result = await evaluator.evaluate(
      {
        conditionId,
        condition: declaration.detector,
      },
      {
        timeoutMs: input.wait.timeoutMs,
        pollIntervalMs:
          input.wait.pollIntervalMs,

        ...(input.signal === undefined
          ? {}
          : {
              signal: input.signal,
            }),
      },
    );

    evidenceRefs.push(...result.evidenceRefs);

    if (result.status === 'passed') {
      return {
        status: 'detected',

        outcome: {
          code: code.data,
          message: declaration.description,

          details: {
            detectorIndex: index,
            conditionId,
          },
        },

        evidenceRefs,
      };
    }

    /*
     * "not_met" means this domain outcome is simply not present.
     * Continue to the next declared detector.
     */
    if (result.status === 'not_met') {
      continue;
    }

    return {
      status: 'failure',

      error: {
        code: 'CHECKPOINT_FAILED',

        message:
          `Replay could not reliably evaluate business outcome "${code.data}".`,

        expected: result.expected,
        observed: result.observed,

        details: {
          phase: 'business_outcome_detection',
          reason:
            'BUSINESS_OUTCOME_DETECTOR_ERROR',
          businessOutcomeCode: code.data,
          detectorIndex: index,
          underlyingErrorCode:
            result.error.code,
        },
      },

      evidenceRefs,
    };
  }

  return {
    status: 'none',
    evidenceRefs,
  };
}