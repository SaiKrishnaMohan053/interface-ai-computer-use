import { z } from 'zod';

import { interventionSourceSchema } from './intervention-types.js';

export const INTERVENTION_AUDIT_EVENT_TYPES = [
  'intervention.created',
  'human.acquire_requested',
  'human.control_acquired',
  'human.action_performed',
  'human.manual_step_confirmed',
  'human.resume_requested',
  'human.abort_requested',
  'human.control_released',
  'automation.control_restored',
] as const;

export const interventionAuditEventTypeSchema = z.enum(INTERVENTION_AUDIT_EVENT_TYPES);

export type InterventionAuditEventType = z.infer<typeof interventionAuditEventTypeSchema>;

export const INTERVENTION_AUDIT_ACTORS = ['AUTOMATION', 'HUMAN', 'SYSTEM'] as const;

export const interventionAuditActorSchema = z.enum(INTERVENTION_AUDIT_ACTORS);

export type InterventionAuditActor = z.infer<typeof interventionAuditActorSchema>;

const identifierSchema = z.string().trim().min(1).max(500);

const timestampSchema = z.string().datetime({
  offset: true,
});

const summarySchema = z.string().trim().min(1).max(1000);

/*
 * Reviewer-facing semantic audit event.
 *
 * Intentionally excludes:
 * - raw mouse coordinates
 * - raw keystrokes
 * - DOM snapshots
 * - cookies/tokens
 * - Browser/Page handles
 *
 * Richer evidence belongs in evidenceRefs; the audit trail
 * records who controlled the session and what semantic
 * lifecycle action occurred.
 */
export const interventionAuditEventSchema = z
  .object({
    eventId: identifierSchema,

    interventionId: identifierSchema,

    sessionId: identifierSchema,

    type: interventionAuditEventTypeSchema,

    actor: interventionAuditActorSchema,

    occurredAt: timestampSchema,

    summary: summarySchema,

    source: interventionSourceSchema.optional(),

    operatorId: identifierSchema.optional(),

    evidenceRefs: z.array(identifierSchema).default([]),
  })
  .strict();

export type InterventionAuditEvent = z.infer<typeof interventionAuditEventSchema>;

export function parseInterventionAuditEvent(value: unknown): InterventionAuditEvent {
  return interventionAuditEventSchema.parse(value);
}

export function isHumanAuditEvent(event: InterventionAuditEvent): boolean {
  return event.type.startsWith('human.');
}
