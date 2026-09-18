import { z } from 'zod';

import { conditionSpecSchema } from '../conditions/index.js';
import { riskLevelSchema } from '../policy/index.js';
import { targetSpecSchema } from '../targeting/index.js';
import { artifactSchemaVersionSchema, capabilityVersionSchema } from './artifact-version.js';

const identifierSchema = z
  .string()
  .trim()
  .min(1, 'Identifier must not be empty')
  .max(200, 'Identifier is too long')
  .regex(
    /^[a-zA-Z][a-zA-Z0-9_-]*$/,
    'Identifier must begin with a letter and contain only letters, numbers, underscores, or hyphens',
  );

const capabilityIdSchema = z
  .string()
  .trim()
  .min(1, 'Capability ID must not be empty')
  .max(200)
  .regex(/^[a-z][a-z0-9_]*$/, 'Capability ID must use lowercase snake_case');

export const capabilityStepIdSchema = z
  .string()
  .trim()
  .min(1, 'Step ID must not be empty')
  .max(200)
  .regex(/^[a-z][a-z0-9-]*$/, 'Step ID must use lowercase kebab-case');

export const waitPolicySchema = z
  .object({
    timeoutMs: z.number().int().positive().max(60_000),

    pollIntervalMs: z.number().int().positive().max(5_000),
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.pollIntervalMs > policy.timeoutMs) {
      context.addIssue({
        code: 'custom',
        message: 'Wait poll interval must not exceed its timeout',
        path: ['pollIntervalMs'],
      });
    }
  });

export const RECOVERY_CONDITIONS = ['TRANSIENT_LOAD', 'KNOWN_INTERSTITIAL'] as const;

export const recoveryConditionSchema = z.enum(RECOVERY_CONDITIONS);

const retryRecoveryPolicySchema = z
  .object({
    kind: z.literal('retry'),
    condition: z.literal('TRANSIENT_LOAD'),
    maxAttempts: z.number().int().min(1).max(3),
    wait: waitPolicySchema.optional(),
  })
  .strict();

const dismissKnownDialogRecoveryPolicySchema = z
  .object({
    kind: z.literal('dismissKnownDialog'),
    condition: z.literal('KNOWN_INTERSTITIAL'),
  })
  .strict();

export const recoveryPolicySchema = z.discriminatedUnion('kind', [
  retryRecoveryPolicySchema,
  dismissKnownDialogRecoveryPolicySchema,
]);

const nameSchema = z.string().trim().min(1, 'Name must not be empty').max(200);

const descriptionSchema = z.string().trim().min(1, 'Description must not be empty').max(4_000);

const versionTextSchema = z.string().trim().min(1, 'Version must not be empty').max(100);

const compatibilityValueSchema = z
  .string()
  .trim()
  .min(1, 'Compatibility value must not be empty')
  .max(200);

export const CAPABILITY_ACTION_KINDS = [
  'click',
  'type',
  'select',
  'check',
  'uncheck',
  'navigate',
  'read',
  'wait',
  'dismiss',
] as const;

export const capabilityActionKindSchema = z.enum(CAPABILITY_ACTION_KINDS);

export const capabilityValueTypeSchema = z.enum([
  'string',
  'number',
  'boolean',
  'enum',
  'currency',
]);

export const capabilityIdentitySchema = z
  .object({
    id: capabilityIdSchema,
    name: nameSchema,
    version: capabilityVersionSchema,
    description: descriptionSchema,
  })
  .strict();

export const capabilityCompatibilitySchema = z
  .object({
    application: compatibilityValueSchema,
    surfaceKind: z.enum(['web', 'application']),
    vendorFamily: compatibilityValueSchema.optional(),
    supportedVersionRange: compatibilityValueSchema.optional(),
    variant: compatibilityValueSchema.optional(),
  })
  .strict();

export const capabilityInputSchema = z
  .object({
    name: identifierSchema,
    type: capabilityValueTypeSchema,
    required: z.boolean(),
    description: descriptionSchema,
    sensitive: z.boolean(),
  })
  .strict();

export const capabilityInputBindingSchema = z
  .object({
    kind: z.literal('inputRef'),
    name: identifierSchema,
  })
  .strict();

export const capabilityOutputBindingSchema = z
  .object({
    kind: z.literal('outputRef'),
    name: identifierSchema,
  })
  .strict();

export const capabilityOutputSchema = z
  .object({
    name: identifierSchema,
    type: capabilityValueTypeSchema,
    required: z.boolean(),
    description: descriptionSchema,
  })
  .strict();

const clickCapabilityActionSchema = z
  .object({
    kind: z.literal('click'),
  })
  .strict();

const typeCapabilityActionSchema = z
  .object({
    kind: z.literal('type'),
    value: capabilityInputBindingSchema,
    mode: z.enum(['replace', 'append']),
  })
  .strict();

export const capabilitySelectOptionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('label'),
      label: capabilityInputBindingSchema,
    })
    .strict(),

  z
    .object({
      kind: z.literal('value'),
      value: capabilityInputBindingSchema,
    })
    .strict(),
]);

const selectCapabilityActionSchema = z
  .object({
    kind: z.literal('select'),
    option: capabilitySelectOptionSchema,
  })
  .strict();

const checkCapabilityActionSchema = z
  .object({
    kind: z.literal('check'),
  })
  .strict();

const uncheckCapabilityActionSchema = z
  .object({
    kind: z.literal('uncheck'),
  })
  .strict();

const navigateCapabilityActionSchema = z
  .object({
    kind: z.literal('navigate'),
    destination: z.string().trim().min(1).max(2_000),
  })
  .strict();

const readCapabilityActionSchema = z
  .object({
    kind: z.literal('read'),
    source: z.enum(['text', 'value']),
    saveAs: capabilityOutputBindingSchema,
  })
  .strict();

const waitCapabilityActionSchema = z
  .object({
    kind: z.literal('wait'),
    condition: conditionSpecSchema,
  })
  .strict();

const dismissCapabilityActionSchema = z
  .object({
    kind: z.literal('dismiss'),
    response: z.enum(['dismiss', 'accept']),
  })
  .strict();

export const capabilityActionSchema = z.discriminatedUnion('kind', [
  clickCapabilityActionSchema,
  typeCapabilityActionSchema,
  selectCapabilityActionSchema,
  checkCapabilityActionSchema,
  uncheckCapabilityActionSchema,
  navigateCapabilityActionSchema,
  readCapabilityActionSchema,
  waitCapabilityActionSchema,
  dismissCapabilityActionSchema,
]);

export const capabilityStepSchema = z
  .object({
    id: capabilityStepIdSchema,

    description: descriptionSchema,

    action: capabilityActionSchema,

    target: targetSpecSchema.optional(),

    preconditions: z.array(conditionSpecSchema).min(1).max(20).optional(),

    wait: waitPolicySchema.optional(),

    postconditions: z.array(conditionSpecSchema).min(1).max(20).optional(),

    recovery: z.array(recoveryPolicySchema).min(1).max(5).optional(),

    risk: riskLevelSchema,
  })
  .strict();

export const knownBusinessOutcomeSchema = z
  .object({
    code: identifierSchema,
    description: descriptionSchema,
    detector: conditionSpecSchema,
  })
  .strict();

export const capabilityRiskMetadataSchema = z
  .object({
    /**
     * Overall business-effect classification of the capability.
     *
     * This does not replace per-step risk classification.
     */
    summaryRisk: riskLevelSchema,

    /**
     * Highest interaction risk declared by any persisted capability step.
     */
    maxStepRisk: riskLevelSchema,

    requiresHumanByDefault: z.boolean(),

    /**
     * Persisted risk metadata is never an authorization decision.
     * Replay must re-evaluate runtime policy before execution.
     */
    runtimePolicyRequired: z.literal(true),
  })
  .strict();

export const capabilityProvenanceSchema = z
  .object({
    discoveryRunId: identifierSchema,

    /**
     * Persist timestamps as ISO strings, never Date instances.
     */
    compiledAt: z.iso.datetime({ offset: true }),

    compilerVersion: versionTextSchema,
  })
  .strict();

export const capabilityMetadataSchema = z
  .object({
    tags: z.array(identifierSchema).max(50).optional(),

    notes: z.string().trim().min(1).max(4_000).optional(),
  })
  .strict();

export const artifactSurfaceSuccessConditionSchema = z
  .object({
    kind: z.literal('surface'),
    condition: conditionSpecSchema,
  })
  .strict();

export const artifactOutputPresentSuccessConditionSchema = z
  .object({
    kind: z.literal('outputPresent'),
    output: capabilityOutputBindingSchema,
  })
  .strict();

export const artifactSuccessLeafSchema = z.union([
  artifactSurfaceSuccessConditionSchema,
  artifactOutputPresentSuccessConditionSchema,
]);

export const artifactAllSuccessConditionSchema = z
  .object({
    kind: z.literal('all'),
    conditions: z.array(artifactSuccessLeafSchema).min(2).max(10),
  })
  .strict();

export const artifactAnySuccessConditionSchema = z
  .object({
    kind: z.literal('any'),
    conditions: z.array(artifactSuccessLeafSchema).min(2).max(10),
  })
  .strict();

export const artifactNotSuccessConditionSchema = z
  .object({
    kind: z.literal('not'),
    condition: artifactSuccessLeafSchema,
  })
  .strict();

export const artifactSuccessConditionSchema = z.union([
  artifactSuccessLeafSchema,
  artifactAllSuccessConditionSchema,
  artifactAnySuccessConditionSchema,
  artifactNotSuccessConditionSchema,
]);

/**
 * Persisted, reusable capability contract.
 *
 * This schema intentionally contains only declarative JSON-compatible data:
 * no browser handles, adapter instances, executable functions, sessions,
 * provider SDK objects, or resolved targets.
 */
export const capabilityArtifactSchema = z
  .object({
    schemaVersion: artifactSchemaVersionSchema,

    identity: capabilityIdentitySchema,

    compatibility: capabilityCompatibilitySchema,

    inputs: z.array(capabilityInputSchema).max(100),

    outputs: z.array(capabilityOutputSchema).max(100),

    preconditions: z.array(conditionSpecSchema).max(20).optional(),

    steps: z.array(capabilityStepSchema).min(1).max(100),

    knownBusinessOutcomes: z.array(knownBusinessOutcomeSchema).max(50).optional(),

    successCondition: artifactSuccessConditionSchema,

    risk: capabilityRiskMetadataSchema,

    provenance: capabilityProvenanceSchema,

    metadata: capabilityMetadataSchema.optional(),
  })
  .strict();

export function parseCapabilityArtifact(value: unknown) {
  return capabilityArtifactSchema.parse(value);
}
