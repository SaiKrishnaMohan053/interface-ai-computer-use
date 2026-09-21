import { ConditionEvaluator } from '../conditions/index.js';

import type { CapabilityStep, WaitPolicy } from '../artifact/index.js';

import type { EvidenceReference, JsonValue, SurfaceAdapter } from '../surface/index.js';

import type { TargetStrategy } from '../targeting/index.js';

export type ReplayCheckpointExplanation =
  | {
      readonly status: 'none';
    }
  | {
      readonly status: 'business_outcome';
      readonly code: string;
      readonly message: string;
      readonly details?: Readonly<Record<string, JsonValue>>;
    }
  | {
      readonly status: 'recoverable';
      readonly code: string;
      readonly message: string;
      readonly details?: Readonly<Record<string, JsonValue>>;
    };

export interface ReplayPostconditionFailure {
  readonly code: 'CHECKPOINT_FAILED';
  readonly message: string;
  readonly expected: JsonValue;
  readonly observed: JsonValue;
  readonly details: Readonly<Record<string, JsonValue>>;
}

export type ReplayPostconditionResult =
  | {
      readonly status: 'passed';
      readonly evidenceRefs: readonly EvidenceReference[];
    }
  | {
      readonly status: 'business_outcome';
      readonly outcome: Extract<
        ReplayCheckpointExplanation,
        { readonly status: 'business_outcome' }
      >;
      readonly evidenceRefs: readonly EvidenceReference[];
    }
  | {
      readonly status: 'recoverable';
      readonly condition: Extract<ReplayCheckpointExplanation, { readonly status: 'recoverable' }>;
      readonly evidenceRefs: readonly EvidenceReference[];
    }
  | {
      readonly status: 'failure';
      readonly error: ReplayPostconditionFailure;
      readonly evidenceRefs: readonly EvidenceReference[];
    };

export interface ReplayPostconditionInput {
  readonly adapter: SurfaceAdapter<TargetStrategy>;
  readonly step: CapabilityStep;
  readonly defaultWait: WaitPolicy;
  readonly detectCurrentState: () => Promise<ReplayCheckpointExplanation>;
  readonly signal?: AbortSignal;
}

function failure(
  step: CapabilityStep,
  conditionIndex: number,
  expected: JsonValue,
  observed: JsonValue,
  reason: string,
  underlyingErrorCode?: string,
): ReplayPostconditionFailure {
  return {
    code: 'CHECKPOINT_FAILED',
    message: `Replay postcondition ${conditionIndex + 1} failed for step "${step.id}".`,
    expected,
    observed,
    details: {
      phase: 'postcondition',
      stepId: step.id,
      conditionIndex,
      reason,
      ...(underlyingErrorCode === undefined ? {} : { underlyingErrorCode }),
    },
  };
}

export async function evaluateReplayPostconditions(
  input: ReplayPostconditionInput,
): Promise<ReplayPostconditionResult> {
  const postconditions = input.step.postconditions;

  if (postconditions === undefined || postconditions.length === 0) {
    return {
      status: 'passed',
      evidenceRefs: [],
    };
  }

  const evaluator = new ConditionEvaluator(input.adapter);
  const evidenceRefs: EvidenceReference[] = [];

  const wait = input.step.wait ?? input.defaultWait;

  for (let conditionIndex = 0; conditionIndex < postconditions.length; conditionIndex += 1) {
    const condition = postconditions[conditionIndex];

    if (condition === undefined) {
      return {
        status: 'failure',
        error: failure(
          input.step,
          conditionIndex,
          'declared postcondition',
          'missing',
          'INVALID_POSTCONDITION_ORDER',
        ),
        evidenceRefs,
      };
    }

    const conditionId = `${input.step.id}:postcondition:${conditionIndex}`;

    const result = await evaluator.evaluate(
      {
        conditionId,
        condition,
      },
      {
        timeoutMs: wait.timeoutMs,
        pollIntervalMs: wait.pollIntervalMs,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      },
    );

    evidenceRefs.push(...result.evidenceRefs);

    if (result.status === 'passed') {
      continue;
    }

    /*
     * A failed checkpoint may be explained by a known
     * business outcome or recoverable runtime state.
     */
    const explanation = await input.detectCurrentState();

    if (explanation.status === 'business_outcome') {
      return {
        status: 'business_outcome',
        outcome: explanation,
        evidenceRefs,
      };
    }

    if (explanation.status === 'recoverable') {
      return {
        status: 'recoverable',
        condition: explanation,
        evidenceRefs,
      };
    }

    if (result.status === 'not_met') {
      return {
        status: 'failure',
        error: failure(
          input.step,
          conditionIndex,
          result.expected,
          result.observed,
          result.reason === 'timeout' ? 'POSTCONDITION_TIMEOUT' : 'POSTCONDITION_MISMATCH',
        ),
        evidenceRefs,
      };
    }

    return {
      status: 'failure',
      error: failure(
        input.step,
        conditionIndex,
        result.expected,
        result.observed,
        'POSTCONDITION_EVALUATION_ERROR',
        result.error.code,
      ),
      evidenceRefs,
    };
  }

  return {
    status: 'passed',
    evidenceRefs,
  };
}
