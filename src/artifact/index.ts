export { ArtifactError, ARTIFACT_ERROR_CODES } from './artifact-errors.js';

export {
  capabilityActionSchema,
  capabilityArtifactSchema,
  capabilityCompatibilitySchema,
  capabilityIdentitySchema,
  capabilityStepIdSchema,
  recoveryPolicySchema,
  waitPolicySchema,
  capabilityInputSchema,
  capabilityInputBindingSchema,
  capabilityMetadataSchema,
  capabilityOutputSchema,
  capabilityOutputBindingSchema,
  capabilityProvenanceSchema,
  capabilityRiskMetadataSchema,
  capabilityStepSchema,
  capabilityValueTypeSchema,
  knownBusinessOutcomeSchema,
  parseCapabilityArtifact,
  CAPABILITY_ACTION_KINDS,
  capabilityActionKindSchema,
  capabilitySelectOptionSchema,
  artifactOutputPresentSuccessConditionSchema,
  artifactSuccessConditionSchema,
  artifactSurfaceSuccessConditionSchema,
  artifactAllSuccessConditionSchema,
  artifactAnySuccessConditionSchema,
  artifactNotSuccessConditionSchema,
  artifactSuccessLeafSchema,
  RECOVERY_CONDITIONS,
  recoveryConditionSchema,
} from './artifact-schema.js';

export { PRIMARY_CAPABILITY_ID } from './capability-artifact.js';

export type {
  ArtifactOutputPresentSuccessCondition,
  ArtifactSuccessCondition,
  ArtifactSurfaceSuccessCondition,
  CapabilityAction,
  CapabilityActionKind,
  CapabilityArtifact,
  CapabilityIdentity,
  CapabilityInput,
  CapabilityInputBinding,
  CapabilityOutput,
  CapabilityOutputBinding,
  CapabilitySelectOption,
  CapabilityStep,
  CapabilityStepId,
  RecoveryPolicy,
  WaitPolicy,
  ArtifactAllSuccessCondition,
  ArtifactAnySuccessCondition,
  ArtifactNotSuccessCondition,
  ArtifactSuccessLeaf,
  RecoveryCondition,
  CapabilityRiskMetadata,
  CapabilityProvenance,
} from './capability-artifact.js';

export type { ArtifactErrorCode } from './artifact-errors.js';

export {
  CAPABILITY_VERSIONING_POLICY,
  CURRENT_ARTIFACT_SCHEMA_VERSION,
  artifactSchemaVersionSchema,
  assertValidCapabilityVersion,
  capabilityVersionSchema,
  compareCapabilityVersions,
  isSupportedArtifactSchemaVersion,
  parseArtifactSchemaVersion,
  parseCapabilityVersion,
} from './artifact-version.js';

export type { ParsedCapabilityVersion, ParsedSchemaVersion } from './artifact-version.js';

export { normalizeArtifactTargetSpec } from './artifact-normalizer.js';

export { assertArtifactSafeToPersist } from './artifact-security.js';

export type { ArtifactSecurityScanOptions } from './artifact-security.js';

export {
  ARTIFACT_COMPILER_ELIGIBILITY_ERROR_CODES,
  ARTIFACT_COMPILER_VERSION,
  ARTIFACT_COMPILER_UNSUPPORTED_ACTION_KINDS,
  ArtifactCompilerUnsupportedActionError,
  ArtifactCompiler,
  ArtifactCompilerEligibilityError,
} from './artifact-compiler.js';

export type {
  ArtifactCompilerEligibilityErrorCode,
  ArtifactCompilerUnsupportedActionKind,
  CompileOptions,
  CompileOutputBinding,
  CompileStepMetadata,
  DiscoveryArtifactSource,
} from './artifact-compiler.js';

export { extractSuccessfulDiscoveryPath } from './artifact-normalizer.js';

export type {
  NormalizedDiscoveryAction,
  SuccessfulPathDiscardReason,
  SuccessfulPathDiscardRecord,
  SuccessfulPathExtractionResult,
} from './artifact-normalizer.js';

export { resolveCompileParameters, resolveStringInputReference } from './artifact-parameterizer.js';

export type {
  CompileParameterDefinition,
  CompileParameterDefinitions,
  ParameterizedInputReference,
  ResolvedCompileParameter,
} from './artifact-parameterizer.js';

export {
  ArtifactSemanticValidationError,
  validateCapabilityArtifactSemantics,
} from './artifact-validator.js';

export { serializeCapabilityArtifact } from './artifact-serialization.js';

export { ArtifactStore } from './artifact-store.js';

export type { ArtifactStoreOptions } from './artifact-store.js';

export * from './artifact-integrity.js';
