import type { PolicyActionKind, PolicyDecision, PolicyEngine } from '../policy/index.js';

import type { AgentObservation } from './agent-observation.js';
import type { DiscoveryDecision } from './decision.js';

export type ActionableDiscoveryDecision = Exclude<
  DiscoveryDecision,
  { readonly kind: 'complete' | 'escalate' }
>;

export interface DiscoveryPolicyEvaluation {
  readonly actionKind: PolicyActionKind;
  readonly policyUrl: string;
  readonly decision: PolicyDecision;
}

/**
 * Evaluates one schema-validated model action against deterministic policy.
 * Risk comes from PolicyEngine configuration, never from a model claim.
 */
export function evaluateDiscoveryActionPolicy(input: {
  readonly policyEngine: PolicyEngine;
  readonly observation: AgentObservation;
  readonly decision: ActionableDiscoveryDecision;
}): DiscoveryPolicyEvaluation {
  const actionKind: PolicyActionKind = input.decision.kind;
  const policyUrl =
    input.decision.kind === 'navigate'
      ? input.decision.destination
      : input.observation.location.kind === 'web'
        ? input.observation.location.url
        : '';

  return Object.freeze({
    actionKind,
    policyUrl,
    decision: input.policyEngine.evaluate({
      url: policyUrl,
      action: { kind: actionKind },
    }),
  });
}
