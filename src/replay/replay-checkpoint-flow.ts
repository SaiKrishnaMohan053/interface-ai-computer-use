import type { BusinessOutcomeCode } from '../runtime/index.js';

import type { JsonValue } from '../surface/index.js';

export type ReplayCheckpointResult =
  | {
      readonly status: 'passed';
    }
  | {
      readonly status: 'failed';

      readonly message: string;

      readonly expected?: JsonValue;

      readonly observed?: JsonValue;
    };

export type ReplayCheckpointBusinessOutcomeDetectionResult =
  | {
      readonly status: 'none';
    }
  | {
      readonly status: 'business_outcome';

      readonly code: BusinessOutcomeCode;

      readonly message: string;

      readonly details?: Readonly<Record<string, JsonValue>>;
    };

export type ReplayCheckpointFlowResult<TActionResult> =
  | {
      readonly status: 'success';

      readonly actionResult: TActionResult;
    }
  | {
      readonly status: 'business_outcome';

      readonly outcome: {
        readonly code: BusinessOutcomeCode;

        readonly message: string;

        readonly details?: Readonly<Record<string, JsonValue>>;
      };
    }
  | {
      readonly status: 'failure';

      readonly error: {
        readonly code: 'CHECKPOINT_FAILED';

        readonly phase: 'precondition' | 'postcondition' | 'success_condition';

        readonly message: string;

        readonly expected: JsonValue;

        readonly observed: JsonValue;
      };
    };

export interface ReplayCheckpointFlowInput<TActionResult> {
  readonly stepId: string;

  readonly evaluatePreconditions: () => Promise<ReplayCheckpointResult>;

  readonly detectBusinessOutcome: () => Promise<ReplayCheckpointBusinessOutcomeDetectionResult>;

  readonly executeAction: () => Promise<TActionResult>;

  readonly evaluatePostconditions: () => Promise<ReplayCheckpointResult>;

  readonly evaluateSuccessCondition: () => Promise<ReplayCheckpointResult>;
}

function checkpointFailure(
  phase: 'precondition' | 'postcondition' | 'success_condition',

  result: Extract<
    ReplayCheckpointResult,
    {
      readonly status: 'failed';
    }
  >,
): ReplayCheckpointFlowResult<never> {
  return {
    status: 'failure',

    error: {
      code: 'CHECKPOINT_FAILED',

      phase,

      message: result.message,

      expected: result.expected ?? null,

      observed: result.observed ?? null,
    },
  };
}

/**
 * Deterministic checkpoint orchestration.
 *
 * Condition semantics stay owned by the existing replay
 * precondition/postcondition/success-condition evaluators.
 *
 * This seam only enforces ordering and terminal behavior:
 *
 * preconditions
 * -> business outcome detection
 * -> action
 * -> postconditions
 * -> final success condition
 */
export async function executeReplayCheckpointFlow<TActionResult>(
  input: ReplayCheckpointFlowInput<TActionResult>,
): Promise<ReplayCheckpointFlowResult<TActionResult>> {
  const preconditions = await input.evaluatePreconditions();

  if (preconditions.status === 'failed') {
    return checkpointFailure('precondition', preconditions);
  }

  const businessOutcome = await input.detectBusinessOutcome();

  if (businessOutcome.status === 'business_outcome') {
    return {
      status: 'business_outcome',

      outcome: {
        code: businessOutcome.code,

        message: businessOutcome.message,

        ...(businessOutcome.details === undefined
          ? {}
          : {
              details: businessOutcome.details,
            }),
      },
    };
  }

  const actionResult = await input.executeAction();

  const postconditions = await input.evaluatePostconditions();

  if (postconditions.status === 'failed') {
    return checkpointFailure('postcondition', postconditions);
  }

  const successCondition = await input.evaluateSuccessCondition();

  if (successCondition.status === 'failed') {
    return checkpointFailure('success_condition', successCondition);
  }

  return {
    status: 'success',
    actionResult,
  };
}
