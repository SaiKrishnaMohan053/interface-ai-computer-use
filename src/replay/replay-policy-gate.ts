import type { CapabilityStep } from '../artifact/index.js';

import type { PolicyDecision, PolicyEngine, RiskLevel } from '../policy/index.js';

import type { JsonValue } from '../surface/index.js';

import {
  classifyReplayStepRisk,
  compareReplayRisk,
  maxReplayRisk,
} from './replay-risk-classifier.js';

export interface ReplayPolicyFailure {
  readonly code: 'POLICY_DENIED';
  readonly message: string;
  readonly expected: JsonValue;
  readonly observed: JsonValue;
  readonly details: Readonly<Record<string, JsonValue>>;
}

export interface ReplayPolicyIntervention {
  readonly code: 'HUMAN_APPROVAL_REQUIRED';
  readonly message: string;
  readonly details: Readonly<Record<string, JsonValue>>;
}

export type ReplayPolicyGateResult =
  | {
      readonly status: 'allowed';
      readonly runtimeRisk: RiskLevel;
      readonly effectiveRisk: RiskLevel;
      readonly policyDecision: Extract<PolicyDecision, { readonly decision: 'ALLOW' }>;
    }
  | {
      readonly status: 'failure';
      readonly error: ReplayPolicyFailure;
    }
  | {
      readonly status: 'intervention_required';
      readonly intervention: ReplayPolicyIntervention;
    };

export interface ReplayPolicyGateInput {
  readonly step: CapabilityStep;
  readonly url: string;
  readonly policyEngine: PolicyEngine;
}

/**
 * Runtime policy boundary for replay.
 *
 * Order:
 *
 * artifact step
 * -> trusted runtime risk classification
 * -> stored/runtime risk comparison
 * -> effective trusted risk
 * -> PolicyEngine
 * -> allow / deny / require human
 */
export function evaluateReplayPolicy(input: ReplayPolicyGateInput): ReplayPolicyGateResult {
  const runtimeRisk = classifyReplayStepRisk(input.step);

  /*
   * A runtime classification that exceeds persisted metadata means
   * the reusable artifact understates the action's risk.
   *
   * Fail closed rather than silently upgrading and executing.
   */
  if (compareReplayRisk(runtimeRisk, input.step.risk) > 0) {
    return {
      status: 'failure',
      error: {
        code: 'POLICY_DENIED',
        message: 'Runtime replay risk exceeds the persisted artifact step risk.',
        expected: input.step.risk,
        observed: runtimeRisk,
        details: {
          reason: 'ARTIFACT_RISK_MISMATCH',
          stepId: input.step.id,
          storedRisk: input.step.risk,
          runtimeRisk,
        },
      },
    };
  }

  /*
   * Never lower the trusted risk sent to policy.
   *
   * If persisted risk is more conservative than runtime classification,
   * retain the higher persisted risk.
   */
  const effectiveRisk = maxReplayRisk(runtimeRisk, input.step.risk);

  const decision = input.policyEngine.evaluate({
    url: input.url,

    action: {
      kind: input.step.action.kind,
    },

    systemRiskLevel: effectiveRisk,
  });

  switch (decision.decision) {
    case 'ALLOW':
      return {
        status: 'allowed',
        runtimeRisk,
        effectiveRisk,
        policyDecision: decision,
      };

    case 'DENY':
      return {
        status: 'failure',
        error: {
          code: 'POLICY_DENIED',
          message: decision.reason,
          expected: 'ALLOW',
          observed: 'DENY',
          details: {
            reason: 'POLICY_DENIED',
            stepId: input.step.id,
            actionKind: input.step.action.kind,
            storedRisk: input.step.risk,
            runtimeRisk,
            effectiveRisk,
            policyId: decision.policyId,

            ...(decision.matchedRuleId === null
              ? {}
              : {
                  matchedRuleId: decision.matchedRuleId,
                }),
          },
        },
      };

    case 'REQUIRE_HUMAN':
      return {
        status: 'intervention_required',
        intervention: {
          code: 'HUMAN_APPROVAL_REQUIRED',
          message: decision.reason,
          details: {
            stepId: input.step.id,
            actionKind: input.step.action.kind,
            storedRisk: input.step.risk,
            runtimeRisk,
            effectiveRisk,
            policyId: decision.policyId,

            ...(decision.matchedRuleId === null
              ? {}
              : {
                  matchedRuleId: decision.matchedRuleId,
                }),
          },
        },
      };
  }
}
