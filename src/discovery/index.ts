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
  DiscoveryExtractionRecord,
  DiscoveryResult,
  DiscoveryRunState,
  DiscoveryStepOutcome,
  DiscoveryStepRecord,
} from './run-state.js';

export {
  DEFAULT_DISCOVERY_RECENT_STEP_LIMIT,
  appendDiscoveryStep,
  createDiscoveryRunState,
  recordDiscoveryObservationFingerprint,
} from './run-state.js';

export {
  KNOWN_SAFE_DEMO_DIALOG_TITLE,
  detectDiscoveryApplicationState,
} from './runtime-application-state.js';

export type { DiscoveryApplicationState } from './runtime-application-state.js';

export type { CreateDiscoveryRunStateInput } from './run-state.js';

export {
  HARD_DISCOVERY_ACTION_FAILURE_CODES,
  evaluateDiscoveryLoopBudget,
  isHardDiscoveryActionFailure,
} from './stopping-conditions.js';

export type {
  DiscoveryLoopBudgetInput,
  DiscoveryLoopBudgetStopReason,
} from './stopping-conditions.js';

export {
  COMPLETION_REJECTION_CODES,
  verifyDiscoveryCompletion,
  verifyDiscoveryGoalCompletion,
} from './completion-verifier.js';

export type {
  CompletionEvidenceState,
  CompletionRejectionCode,
  CompletionVerificationIssue,
  CompletionVerificationResult,
  GoalCompletionVerificationInput,
} from './completion-verifier.js';

export { DISCOVERY_ESCALATION_SOURCES, createDiscoveryIntervention } from './escalation.js';

export type {
  CreateDiscoveryInterventionOptions,
  DiscoveryEscalationSource,
  DiscoveryEscalationTrigger,
  DiscoveryIntervention,
  HumanPolicyDecision,
  ModelEscalationDecision,
} from './escalation.js';

export * from './agent-observation.js';
export * from './observation-projector.js';
export { createDiscoveryObservationFingerprint } from './observation-fingerprint.js';
export * from './model/index.js';

export {
  DEFAULT_DISCOVERY_MODEL_FORMAT_RETRIES,
  MAX_DISCOVERY_MODEL_FORMAT_RETRIES,
  DiscoveryDecisionValidationError,
  requestValidatedDiscoveryDecision,
} from './model-decision-validation.js';

export type { ValidatedDiscoveryDecision } from './model-decision-validation.js';

export {
  TRANSLATABLE_DISCOVERY_DECISION_KINDS,
  DiscoveryActionTranslationError,
  getDiscoveryDecisionTarget,
  translateDiscoveryDecision,
} from './action-translator.js';

export type {
  DiscoveryActionTranslationErrorCode,
  DiscoveryActionTranslationInput,
  TranslatableDiscoveryDecision,
} from './action-translator.js';

export { extractDiscoveryRead, retainDiscoveryExtraction } from './read-extraction.js';

export type {
  DiscoveryReadDecision,
  DiscoveryReadExtractionResult,
  ExtractDiscoveryReadInput,
  SuccessfulActionResult,
} from './read-extraction.js';

export { evaluateDiscoveryActionPolicy } from './discovery-policy-gate.js';

export type {
  ActionableDiscoveryDecision,
  DiscoveryPolicyEvaluation,
} from './discovery-policy-gate.js';

export { classifyDiscoveryDecisionRisk } from './discovery-risk-classifier.js';

export type { DiscoveryRiskClassification } from './discovery-risk-classifier.js';

export {
  discoveryBusinessOutcomeResultSchema,
  discoveryFailureResultSchema,
  discoveryInterventionRequiredResultSchema,
  discoveryRunResultSchema,
  discoverySuccessResultSchema,
  parseDiscoveryRunResult,
  withDiscoverySteps,
} from './discovery-result.js';

export type {
  DiscoveryBusinessOutcomeResult,
  DiscoveryFailureResult,
  DiscoveryInterventionRequiredResult,
  DiscoveryRunResult,
  DiscoverySuccessResult,
} from './discovery-result.js';

export {
  discoveryDecisionRationale,
  discoveryTraceRecordSchema,
  parseDiscoveryTraceRecord,
  recordDiscoveryTrace,
} from './discovery-trace.js';

export type { DiscoveryTraceRecord, DiscoveryTraceSink } from './discovery-trace.js';

export {
  DEFAULT_DISCOVERY_CONDITION_POLL_INTERVAL_MS,
  DEFAULT_DISCOVERY_MAX_REPEATED_STATES,
  DEFAULT_DISCOVERY_OPERATION_TIMEOUT_MS,
  DiscoveryEngine,
} from './discovery-engine.js';

export type {
  DiscoveryCoordinator,
  DiscoveryEngineDependencies,
  DiscoveryEngineOptions,
  DiscoveryRunOptions,
} from './discovery-engine.js';
