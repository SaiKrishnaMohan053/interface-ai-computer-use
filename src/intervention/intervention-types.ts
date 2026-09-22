import { z } from 'zod';

import { interventionReasonCodeSchema, runtimeEvidenceReferenceSchema } from '../runtime/index.js';

export const INTERVENTION_STATUSES = [
  'REQUESTED',
  'WAITING_FOR_HUMAN',
  'ACQUIRED',
  'IN_PROGRESS',
  'RESOLVED',
  'ABORTED',
  'EXPIRED',
] as const;

export const interventionStatusSchema = z.enum(INTERVENTION_STATUSES);

export type InterventionStatus = z.infer<typeof interventionStatusSchema>;

export const INTERVENTION_SOURCES = ['DISCOVERY', 'REPLAY'] as const;

export const interventionSourceSchema = z.enum(INTERVENTION_SOURCES);

export type InterventionSource = z.infer<typeof interventionSourceSchema>;

const identifierSchema = z.string().trim().min(1).max(500);

const optionalIdentifierSchema = identifierSchema.optional();

const timestampSchema = z.iso.datetime({ offset: true });

const messageSchema = z.string().trim().min(1).max(10_000);

const observedStateSchema = z.string().trim().min(1).max(20_000);

/**
 * Sanitized context required by a human operator.
 *
 * This is data only.
 *
 * It must never contain:
 * - Browser
 * - BrowserContext
 * - Page
 * - locator handles
 * - cookies
 * - tokens
 * - credentials
 * - raw session storage
 */
export const interventionContextSchema = z
  .object({
    source: interventionSourceSchema,

    capabilityId: optionalIdentifierSchema,
    capabilityVersion: optionalIdentifierSchema,

    goal: z.string().trim().min(1).max(4_000).optional(),

    stepId: optionalIdentifierSchema,

    observedState: observedStateSchema,

    location: z.string().trim().min(1).max(4_000).optional(),

    actionKind: optionalIdentifierSchema,

    riskLevel: z.enum(['READ_ONLY', 'REVERSIBLE', 'SENSITIVE_WRITE', 'IRREVERSIBLE']).optional(),

    details: z.record(z.string(), z.json()).default({}),
  })
  .strict();

export type InterventionContext = z.infer<typeof interventionContextSchema>;

export const interventionRequestSchema = z
  .object({
    id: identifierSchema,

    sessionId: identifierSchema,

    source: interventionSourceSchema,

    capabilityId: optionalIdentifierSchema,
    capabilityVersion: optionalIdentifierSchema,

    goal: z.string().trim().min(1).max(4_000).optional(),

    stepId: optionalIdentifierSchema,

    reasonCode: interventionReasonCodeSchema,

    reason: messageSchema,

    observedState: observedStateSchema,

    evidenceRefs: z.array(runtimeEvidenceReferenceSchema),

    createdAt: timestampSchema,

    status: interventionStatusSchema,
  })
  .strict();

export type InterventionRequest = z.infer<typeof interventionRequestSchema>;

export const INTERVENTION_RESOLUTION_KINDS = ['RESUME', 'ABORT'] as const;

export const interventionResolutionKindSchema = z.enum(INTERVENTION_RESOLUTION_KINDS);

export type InterventionResolutionKind = z.infer<typeof interventionResolutionKindSchema>;

export const INTERVENTION_RESOLUTION_CODES = [
  'MANUAL_ACTION_COMPLETED',
  'APPROVED_TO_CONTINUE',
  'STATE_RESOLVED',
  'HUMAN_ABORTED',
] as const;

export const interventionResolutionCodeSchema = z.enum(INTERVENTION_RESOLUTION_CODES);

export type InterventionResolutionCode = z.infer<typeof interventionResolutionCodeSchema>;

export const interventionResolutionSchema = z
  .object({
    kind: interventionResolutionKindSchema,

    code: interventionResolutionCodeSchema,

    summary: messageSchema,

    resolvedAt: timestampSchema,

    evidenceRefs: z.array(runtimeEvidenceReferenceSchema),
  })
  .strict()
  .superRefine((resolution, context) => {
    if (resolution.kind === 'ABORT' && resolution.code !== 'HUMAN_ABORTED') {
      context.addIssue({
        code: 'custom',
        path: ['code'],
        message: 'ABORT resolution requires HUMAN_ABORTED',
      });
    }

    if (resolution.kind === 'RESUME' && resolution.code === 'HUMAN_ABORTED') {
      context.addIssue({
        code: 'custom',
        path: ['code'],
        message: 'RESUME resolution cannot use HUMAN_ABORTED',
      });
    }
  });

export type InterventionResolution = z.infer<typeof interventionResolutionSchema>;

export const HUMAN_ACTION_KINDS = [
  'CONTROL_ACQUIRED',
  'MANUAL_STEP',
  'RESUME_REQUESTED',
  'ABORT_REQUESTED',
  'CONTROL_RELEASED',
] as const;

export const humanActionKindSchema = z.enum(HUMAN_ACTION_KINDS);

export type HumanActionKind = z.infer<typeof humanActionKindSchema>;

/**
 * Audit record for meaningful human involvement.
 *
 * We intentionally record semantic actions rather than
 * every mouse coordinate or keystroke.
 */
export const humanActionRecordSchema = z
  .object({
    actionId: identifierSchema,

    interventionId: identifierSchema,

    sessionId: identifierSchema,

    kind: humanActionKindSchema,

    summary: messageSchema,

    occurredAt: timestampSchema,

    evidenceRefs: z.array(runtimeEvidenceReferenceSchema),

    details: z.record(z.string(), z.json()).default({}),
  })
  .strict();

export type HumanActionRecord = z.infer<typeof humanActionRecordSchema>;

export function parseInterventionRequest(value: unknown): InterventionRequest {
  return interventionRequestSchema.parse(value);
}

export function parseInterventionContext(value: unknown): InterventionContext {
  return interventionContextSchema.parse(value);
}

export function parseInterventionResolution(value: unknown): InterventionResolution {
  return interventionResolutionSchema.parse(value);
}

export function parseHumanActionRecord(value: unknown): HumanActionRecord {
  return humanActionRecordSchema.parse(value);
}
