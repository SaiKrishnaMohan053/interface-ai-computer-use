import type { AgentObservation } from '../agent-observation.js';
import type { DiscoveryDecision } from '../decision.js';

export interface DiscoveryModelInput {
  readonly observation: AgentObservation;
}

/**
 * Provider-neutral model boundary used by the Discovery Engine.
 *
 * Tests can supply a deterministic implementation without importing
 * or mocking the OpenAI SDK.
 */
export interface DiscoveryDecisionModel {
  decide(input: DiscoveryModelInput): Promise<DiscoveryDecision>;
}
