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

const nameSchema = z.string().trim().min(1, 'Name must not be empty').max(200);

const descriptionSchema = z.string().trim().min(1, 'Description must not be empty').max(4_000);

const versionTextSchema = z.string().trim().min(1, 'Version must not be empty').max(100);

const compatibilityValueSchema = z
  .string()
  .trim()
  .min(1, 'Compatibility value must not be empty')
  .max(200);

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

/**
 * Phase 3.3 intentionally establishes only the persisted action-kind shell.
 *
 * Typed value bindings, read output bindings, and other action-specific
 * payloads are introduced by the dedicated binding/action-schema steps.
 */
const simpleCapabilityActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('click') }).strict(),
  z.object({ kind: z.literal('check') }).strict(),
  z.object({ kind: z.literal('uncheck') }).strict(),
  z.object({ kind: z.literal('navigate') }).strict(),
  z.object({ kind: z.literal('wait') }).strict(),
  z.object({ kind: z.literal('dismiss') }).strict(),
]);

const readCapabilityActionSchema = z
  .object({
    kind: z.literal('read'),
    saveAs: capabilityOutputBindingSchema,
  })
  .strict();

const typedInputActionSchema = z
  .object({
    kind: z.literal('type'),

    value: capabilityInputBindingSchema,

    mode: z.enum(['replace', 'append']),
  })
  .strict();

/**
 * Phase 3.6 introduces input-bound typing.
 *
 * Literal invocation values are intentionally not part of the persisted
 * type action contract. The action points to a declared artifact input.
 *
 * Select bindings are introduced when their value semantics are defined.
 */
export const capabilityActionSchema = z.union([
  typedInputActionSchema,
  simpleCapabilityActionSchema,
  readCapabilityActionSchema,
]);

export const capabilityStepSchema = z
  .object({
    id: identifierSchema,
    description: descriptionSchema,

    action: capabilityActionSchema,

    /**
     * Navigation and some future surface-neutral actions do not require
     * an element target. Action/target compatibility is semantic validation,
     * not top-level shape validation.
     */
    target: targetSpecSchema.optional(),

    preconditions: z.array(conditionSpecSchema).max(20).optional(),

    postconditions: z.array(conditionSpecSchema).max(20).optional(),

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
    maxRisk: riskLevelSchema,
    requiresHumanByDefault: z.boolean(),
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

/**
 * Phase 3.3 reuses the existing persisted ConditionSpec directly.
 *
 * Composite conditions and artifact-only conditions such as outputPresent
 * are introduced in their dedicated Phase 3 step.
 */
export const capabilitySuccessConditionSchema = conditionSpecSchema;

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

    successCondition: capabilitySuccessConditionSchema,

    risk: capabilityRiskMetadataSchema,

    provenance: capabilityProvenanceSchema,

    metadata: capabilityMetadataSchema.optional(),
  })
  .strict();

export function parseCapabilityArtifact(value: unknown) {
  return capabilityArtifactSchema.parse(value);
}
