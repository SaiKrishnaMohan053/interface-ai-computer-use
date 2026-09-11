export {
  DEFAULT_DISCOVERY_MAX_STEPS,
  DEFAULT_DISCOVERY_TIMEOUT_MS,
  discoveryLimitsSchema,
  discoveryRequestSchema,
  discoveryRunConfigSchema,
  discoveryTargetSchema,
  parseDiscoveryRequest,
  resolveDiscoveryRunConfig,
} from './contracts.js';

export {
  AGENT_TARGET_STRATEGY_KINDS,
  DISCOVERY_DECISION_KINDS,
  agentConditionSchema,
  agentTargetSpecSchema,
  agentTargetStrategySchema,
  agentTargetTextMatchSchema,
  discoveryDecisionSchema,
  parseDiscoveryDecision,
} from './decision.js';

export type {
  DiscoveryLimits,
  DiscoveryRequest,
  DiscoveryRunConfig,
  DiscoveryTarget,
} from './contracts.js';

export type {
  AgentCondition,
  AgentTargetSpec,
  AgentTargetStrategy,
  AgentTargetTextMatch,
  DiscoveryCompletion,
  DiscoveryDecision,
} from './decision.js';

export type {
  DiscoveryResult,
  DiscoveryRunState,
  DiscoveryStepOutcome,
  DiscoveryStepRecord,
} from './run-state.js';
