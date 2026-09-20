import { ConditionEvaluator } from '../conditions/index.js';

import type { WaitPolicy } from '../artifact/index.js';

import type { EvidenceReference, JsonValue, SurfaceAdapter } from '../surface/index.js';

import type { TargetStrategy } from '../targeting/index.js';

import type { ReplayRuntimeSignal } from './replay-runtime-classifier.js';

const APPLICATION_ERROR_CONDITION = {
  kind: 'textPresent',
  text: 'Application error',
  match: 'contains',
  caseSensitive: false,
} as const;

export interface ReplayApplicationErrorDetectionInput {
  readonly adapter: SurfaceAdapter<TargetStrategy>;

  readonly stepId: string;

  readonly wait: WaitPolicy;

  readonly captureEvidence: () => Promise<readonly EvidenceReference[]>;

  readonly signal?: AbortSignal;
}

export interface ReplayApplicationErrorDetectionResult {
  readonly signal: ReplayRuntimeSignal;

  readonly evidenceRefs: readonly EvidenceReference[];
}

function detectorFailure(
  stepId: string,
  observed: JsonValue,
  underlyingErrorCode: string,
): ReplayRuntimeSignal {
  return {
    kind: 'failure',

    code: 'CHECKPOINT_FAILED',

    message: 'Replay could not reliably evaluate the application error state.',

    expected: 'reliable application-state evaluation',

    observed,

    details: {
      phase: 'application_error_detection',

      stepId,

      underlyingErrorCode,
    },
  };
}

export async function detectReplayApplicationError(
  input: ReplayApplicationErrorDetectionInput,
): Promise<ReplayApplicationErrorDetectionResult> {
  const evaluator = new ConditionEvaluator(input.adapter);

  const conditionId = `runtime-state:application-error:${input.stepId}`;

  const result = await evaluator.evaluate(
    {
      conditionId,

      condition: APPLICATION_ERROR_CONDITION,
    },
    {
      timeoutMs: input.wait.timeoutMs,

      pollIntervalMs: input.wait.pollIntervalMs,

      ...(input.signal === undefined
        ? {}
        : {
            signal: input.signal,
          }),
    },
  );

  const evidenceRefs: EvidenceReference[] = [...result.evidenceRefs];

  if (result.status === 'error') {
    return {
      signal: detectorFailure(input.stepId, result.observed, result.error.code),

      evidenceRefs,
    };
  }

  if (result.status === 'not_met') {
    return {
      signal: {
        kind: 'none',
      },

      evidenceRefs,
    };
  }

  const captured = await input.captureEvidence();

  evidenceRefs.push(...captured);

  return {
    signal: {
      kind: 'failure',

      code: 'APPLICATION_ERROR',

      message: `Application error detected while executing replay step "${input.stepId}".`,

      expected: 'application remains operational',

      observed: result.observed,

      details: {
        phase: 'application_error_detection',

        stepId: input.stepId,

        observedState: result.observed,

        evidenceCount: evidenceRefs.length,

        recoveryDeclared: false,
      },
    },

    evidenceRefs,
  };
}
