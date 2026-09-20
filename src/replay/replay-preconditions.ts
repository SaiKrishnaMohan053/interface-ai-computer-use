import {
  ConditionEvaluator,
} from '../conditions/index.js';

import type {
  CapabilityStep,
  WaitPolicy,
} from '../artifact/index.js';

import type {
  EvidenceReference,
  JsonValue,
  SurfaceAdapter,
} from '../surface/index.js';

import type {
  TargetStrategy,
} from '../targeting/index.js';

export interface ReplayCheckpointFailure {
  readonly code: 'CHECKPOINT_FAILED';
  readonly message: string;
  readonly expected: JsonValue;
  readonly observed: JsonValue;
  readonly details: Readonly<Record<string, JsonValue>>;
}

export type ReplayPreconditionResult =
  | {
      readonly status: 'passed';
      readonly evidenceRefs: readonly EvidenceReference[];
    }
  | {
      readonly status: 'failure';
      readonly error: ReplayCheckpointFailure;
      readonly evidenceRefs: readonly EvidenceReference[];
    };

export interface ReplayPreconditionInput {
  readonly adapter: SurfaceAdapter<TargetStrategy>;
  readonly step: CapabilityStep;

  /**
   * Used only when the artifact step does not persist its own wait policy.
   *
   * This must come from deterministic replay runtime configuration,
   * not from an LLM or dynamic guess.
   */
  readonly defaultWait: WaitPolicy;

  readonly signal?: AbortSignal;
}

function checkpointFailure(
  step: CapabilityStep,
  input: {
    readonly conditionIndex: number;
    readonly conditionId: string;
    readonly expected: JsonValue;
    readonly observed: JsonValue;
    readonly reason: string;
    readonly underlyingErrorCode?: string;
  },
): ReplayCheckpointFailure {
  return {
    code: 'CHECKPOINT_FAILED',

    message:
      `Replay precondition ${input.conditionIndex + 1} ` +
      `failed for step "${step.id}".`,

    expected: input.expected,
    observed: input.observed,

    details: {
      phase: 'precondition',
      stepId: step.id,
      conditionIndex: input.conditionIndex,
      conditionId: input.conditionId,
      reason: input.reason,

      ...(input.underlyingErrorCode === undefined
        ? {}
        : {
            underlyingErrorCode:
              input.underlyingErrorCode,
          }),
    },
  };
}

/**
 * Evaluates persisted preconditions in declared order.
 *
 * Important ordering invariant:
 *
 * Runtime/business-outcome detection belongs immediately before this
 * function in StepExecutor.
 *
 * Therefore a CHECKPOINT_FAILED result means the caller already found
 * no recognized business/runtime condition explaining the current state.
 */
export async function evaluateReplayPreconditions(
  input: ReplayPreconditionInput,
): Promise<ReplayPreconditionResult> {
  const preconditions = input.step.preconditions;

  if (
    preconditions === undefined ||
    preconditions.length === 0
  ) {
    return {
      status: 'passed',
      evidenceRefs: [],
    };
  }

  const evaluator = new ConditionEvaluator(
    input.adapter,
  );

  const evidenceRefs: EvidenceReference[] = [];

  const wait =
    input.step.wait ?? input.defaultWait;

  for (
    let conditionIndex = 0;
    conditionIndex < preconditions.length;
    conditionIndex += 1
  ) {
    const condition =
      preconditions[conditionIndex];

    if (condition === undefined) {
      return {
        status: 'failure',
        error: checkpointFailure(input.step, {
          conditionIndex,
          conditionId:
            `${input.step.id}:precondition:${conditionIndex}`,
          expected: 'declared precondition',
          observed: 'missing',
          reason: 'INVALID_PRECONDITION_ORDER',
        }),
        evidenceRefs,
      };
    }

    const conditionId =
      `${input.step.id}:precondition:${conditionIndex}`;

    const result = await evaluator.evaluate(
      {
        conditionId,
        condition,
      },
      {
        timeoutMs: wait.timeoutMs,
        pollIntervalMs: wait.pollIntervalMs,

        ...(input.signal === undefined
          ? {}
          : {
              signal: input.signal,
            }),
      },
    );

    evidenceRefs.push(...result.evidenceRefs);

    switch (result.status) {
      case 'passed':
        continue;

      case 'not_met':
        return {
          status: 'failure',

          error: checkpointFailure(input.step, {
            conditionIndex,
            conditionId,
            expected: result.expected,
            observed: result.observed,
            reason:
              result.reason === 'timeout'
                ? 'PRECONDITION_TIMEOUT'
                : 'PRECONDITION_MISMATCH',
          }),

          evidenceRefs,
        };

      case 'error':
        return {
          status: 'failure',

          error: checkpointFailure(input.step, {
            conditionIndex,
            conditionId,
            expected: result.expected,
            observed: result.observed,
            reason:
              'PRECONDITION_EVALUATION_ERROR',
            underlyingErrorCode:
              result.error.code,
          }),

          evidenceRefs,
        };
    }
  }

  return {
    status: 'passed',
    evidenceRefs,
  };
}