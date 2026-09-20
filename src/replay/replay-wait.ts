import { ConditionEvaluator } from '../conditions/index.js';

import type { CapabilityStep } from '../artifact/index.js';

import type { EvidenceReference, JsonValue, SurfaceAdapter } from '../surface/index.js';

import type { TargetStrategy } from '../targeting/index.js';

export interface ReplayWaitFailure {
  readonly code: 'CHECKPOINT_FAILED';
  readonly message: string;
  readonly expected: JsonValue;
  readonly observed: JsonValue;
  readonly details: Readonly<Record<string, JsonValue>>;
}

export type ReplayWaitResult =
  | {
      readonly status: 'passed';
      readonly evidenceRefs: readonly EvidenceReference[];
    }
  | {
      readonly status: 'failure';
      readonly error: ReplayWaitFailure;
      readonly evidenceRefs: readonly EvidenceReference[];
    };

export interface ReplayWaitInput {
  readonly adapter: SurfaceAdapter<TargetStrategy>;
  readonly step: CapabilityStep;
  readonly signal?: AbortSignal;
}

function waitFailure(
  step: CapabilityStep,
  input: {
    readonly expected: JsonValue;
    readonly observed: JsonValue;
    readonly reason: string;
    readonly underlyingErrorCode?: string;
  },
): ReplayWaitFailure {
  return {
    code: 'CHECKPOINT_FAILED',

    message: `Replay wait failed for step "${step.id}".`,

    expected: input.expected,
    observed: input.observed,

    details: {
      phase: 'wait',
      stepId: step.id,
      reason: input.reason,

      ...(input.underlyingErrorCode === undefined
        ? {}
        : {
            underlyingErrorCode: input.underlyingErrorCode,
          }),
    },
  };
}

/**
 * Executes an explicit persisted wait step using ConditionEvaluator.
 *
 * No fixed sleeps are used. The persisted wait policy supplies the
 * timeout and polling interval.
 */
export async function evaluateReplayWait(input: ReplayWaitInput): Promise<ReplayWaitResult> {
  if (input.step.action.kind !== 'wait') {
    return {
      status: 'failure',
      error: waitFailure(input.step, {
        expected: 'wait action',
        observed: input.step.action.kind,
        reason: 'NOT_A_WAIT_STEP',
      }),
      evidenceRefs: [],
    };
  }

  if (input.step.wait === undefined) {
    return {
      status: 'failure',
      error: waitFailure(input.step, {
        expected: 'artifact-defined bounded wait policy',
        observed: 'missing',
        reason: 'WAIT_POLICY_MISSING',
      }),
      evidenceRefs: [],
    };
  }

  const evaluator = new ConditionEvaluator(input.adapter);

  const conditionId = `${input.step.id}:wait`;

  const result = await evaluator.evaluate(
    {
      conditionId,
      condition: input.step.action.condition,
    },
    {
      timeoutMs: input.step.wait.timeoutMs,
      pollIntervalMs: input.step.wait.pollIntervalMs,

      ...(input.signal === undefined
        ? {}
        : {
            signal: input.signal,
          }),
    },
  );

  switch (result.status) {
    case 'passed':
      return {
        status: 'passed',
        evidenceRefs: result.evidenceRefs,
      };

    case 'not_met':
      return {
        status: 'failure',

        error: waitFailure(input.step, {
          expected: result.expected,
          observed: result.observed,

          reason: result.reason === 'timeout' ? 'WAIT_TIMEOUT' : 'WAIT_CONDITION_MISMATCH',
        }),

        evidenceRefs: result.evidenceRefs,
      };

    case 'error':
      return {
        status: 'failure',

        error: waitFailure(input.step, {
          expected: result.expected,
          observed: result.observed,
          reason: 'WAIT_EVALUATION_ERROR',
          underlyingErrorCode: result.error.code,
        }),

        evidenceRefs: result.evidenceRefs,
      };
  }
}
