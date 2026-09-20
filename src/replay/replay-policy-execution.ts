import type { JsonValue } from '../surface/index.js';

export type ReplayPolicyExecutionDecision =
  | {
      readonly decision: 'ALLOW';
      readonly riskLevel: 'READ_ONLY' | 'REVERSIBLE';
    }
  | {
      readonly decision: 'DENY';
      readonly code: 'POLICY_DENIED';
      readonly riskLevel: 'READ_ONLY' | 'REVERSIBLE' | 'SENSITIVE_WRITE' | 'IRREVERSIBLE';
    }
  | {
      readonly decision: 'REQUIRE_HUMAN';
      readonly code: 'HUMAN_APPROVAL_REQUIRED';
      readonly riskLevel: 'READ_ONLY' | 'REVERSIBLE' | 'SENSITIVE_WRITE' | 'IRREVERSIBLE';
    };

export type ReplayPolicyExecutionResult<T> =
  | {
      readonly status: 'executed';
      readonly result: T;
    }
  | {
      readonly status: 'failure';

      readonly error: {
        readonly code: 'POLICY_DENIED';

        readonly message: string;

        readonly details: Readonly<Record<string, JsonValue>>;
      };
    }
  | {
      readonly status: 'intervention_required';

      readonly intervention: {
        readonly code: 'HUMAN_APPROVAL_REQUIRED';

        readonly message: string;

        readonly details: Readonly<Record<string, JsonValue>>;
      };
    };

export interface ReplayPolicyExecutionInput<T> {
  readonly stepId: string;

  readonly decision: ReplayPolicyExecutionDecision;

  readonly executeAction: () => Promise<T>;
}

/**
 * Final execution boundary after the existing replay policy
 * gate has evaluated the step.
 *
 * This helper does not make policy decisions itself.
 * It only enforces:
 *
 * ALLOW         -> execute
 * DENY          -> stop
 * REQUIRE_HUMAN -> stop and request intervention
 */
export async function executePolicyAuthorizedReplayAction<T>(
  input: ReplayPolicyExecutionInput<T>,
): Promise<ReplayPolicyExecutionResult<T>> {
  switch (input.decision.decision) {
    case 'ALLOW':
      return {
        status: 'executed',

        result: await input.executeAction(),
      };

    case 'DENY':
      return {
        status: 'failure',

        error: {
          code: 'POLICY_DENIED',

          message: 'Replay action was denied by runtime policy.',

          details: {
            stepId: input.stepId,

            riskLevel: input.decision.riskLevel,

            policyDecision: 'DENY',
          },
        },
      };

    case 'REQUIRE_HUMAN':
      return {
        status: 'intervention_required',

        intervention: {
          code: 'HUMAN_APPROVAL_REQUIRED',

          message: 'Replay action requires human approval.',

          details: {
            stepId: input.stepId,

            riskLevel: input.decision.riskLevel,

            policyDecision: 'REQUIRE_HUMAN',
          },
        },
      };
  }
}
