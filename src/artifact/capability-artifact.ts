import type { z } from 'zod';

import type {
  capabilityActionSchema,
  capabilityArtifactSchema,
  capabilityCompatibilitySchema,
  capabilityIdentitySchema,
  capabilityInputBindingSchema,
  capabilityInputSchema,
  capabilityMetadataSchema,
  capabilityOutputSchema,
  capabilityOutputBindingSchema,
  capabilityProvenanceSchema,
  capabilityRiskMetadataSchema,
  capabilityStepSchema,
  capabilitySuccessConditionSchema,
  capabilityValueTypeSchema,
  knownBusinessOutcomeSchema,
} from './artifact-schema.js';

export type CapabilityValueType = z.infer<typeof capabilityValueTypeSchema>;

export type CapabilityIdentity = z.infer<typeof capabilityIdentitySchema>;

export type CapabilityCompatibility = z.infer<typeof capabilityCompatibilitySchema>;

export type CapabilityInput = z.infer<typeof capabilityInputSchema>;

export type CapabilityInputBinding = z.infer<typeof capabilityInputBindingSchema>;

export type CapabilityOutput = z.infer<typeof capabilityOutputSchema>;

export type CapabilityOutputBinding = z.infer<typeof capabilityOutputBindingSchema>;

export type CapabilityAction = z.infer<typeof capabilityActionSchema>;

export type CapabilityStep = z.infer<typeof capabilityStepSchema>;

export type KnownBusinessOutcome = z.infer<typeof knownBusinessOutcomeSchema>;

export type CapabilityRiskMetadata = z.infer<typeof capabilityRiskMetadataSchema>;

export type CapabilityProvenance = z.infer<typeof capabilityProvenanceSchema>;

export type CapabilityMetadata = z.infer<typeof capabilityMetadataSchema>;

export type CapabilitySuccessCondition = z.infer<typeof capabilitySuccessConditionSchema>;

export type CapabilityArtifact = z.infer<typeof capabilityArtifactSchema>;

export const PRIMARY_CAPABILITY_ID = 'lookup_savings_balance' as const;
