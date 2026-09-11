export {
  DISCOVERY_HISTORY_SUMMARY_LIMIT,
  DISCOVERY_MODEL_HISTORY_LIMIT,
  buildDiscoveryModelContext,
  createDiscoveryModelInput,
  discoveryHistoryEntrySchema,
  discoveryModelContextSchema,
} from './discovery-decision-model.js';

export type {
  DiscoveryDecisionModel,
  DiscoveryHistoryEntry,
  DiscoveryModelContext,
  DiscoveryModelInput,
} from './discovery-decision-model.js';

export {
  ModelConfigurationError,
  SUPPORTED_OPENAI_DISCOVERY_MODELS,
  isSupportedOpenAIDiscoveryModel,
  loadOpenAIDiscoveryModelConfig,
  openAIDiscoveryModelConfigSchema,
  validateOpenAIDiscoveryModelConfig,
} from './model-config.js';

export type {
  ModelConfigurationIssue,
  ModelConfigurationIssueCode,
  OpenAIDiscoveryModelConfig,
} from './model-config.js';

export {
  DiscoveryModelResponseError,
  OpenAIDiscoveryDecisionModel,
  createOpenAIDiscoveryDecisionModelFromEnvironment,
} from './openai-model.js';

export type { OpenAIDecisionTransport, OpenAIDecisionTransportRequest } from './openai-model.js';
export { DISCOVERY_SYSTEM_PROMPT } from './discovery-system-prompt.js';
