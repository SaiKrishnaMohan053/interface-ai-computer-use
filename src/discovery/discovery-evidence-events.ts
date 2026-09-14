import { z } from 'zod';

import type { RecordEventInput } from '../evidence/index.js';
import {
  policyActionKindSchema,
  policyDecisionKindSchema,
  riskLevelSchema,
} from '../policy/index.js';
import { runtimeEvidenceReferenceSchema } from '../runtime/index.js';

import { DISCOVERY_DECISION_KINDS } from './decision.js';

export const DISCOVERY_EVIDENCE_EVENT_NAMES = [
  'discovery.started',
  'observation.captured',
  'model.decision.requested',
  'model.decision.received',
  'model.decision.invalid',
  'policy.evaluated',
  'target.resolved',
  'action.started',
  'action.completed',
  'action.failed',
  'value.extracted',
  'stuck.detected',
  'discovery.completed',
  'discovery.business_outcome',
  'discovery.failed',
  'discovery.escalated',
] as const;

const stepSchema = z.number().int().nonnegative().max(100);

const identifierSchema = z.string().trim().min(1).max(500);

const messageSchema = z.string().trim().min(1).max(2_000);

const evidenceRefsSchema = z.array(runtimeEvidenceReferenceSchema).max(100);

const base = z.object({
  step: stepSchema,
});

export const discoveryEvidenceEventSchema = z.discriminatedUnion('name', [
  base
    .extend({
      name: z.literal('discovery.started'),
      application: identifierSchema,
      maxSteps: z.number().int().min(1).max(100),
      timeoutMs: z
        .number()
        .int()
        .min(1_000)
        .max(15 * 60_000),
    })
    .strict(),

  base
    .extend({
      name: z.literal('observation.captured'),
      observationId: identifierSchema,
      loading: z.enum(['loading', 'complete', 'unknown']),
      controlCount: z.number().int().nonnegative(),
      dialogCount: z.number().int().nonnegative(),
      evidenceRefs: evidenceRefsSchema,
    })
    .strict(),

  base
    .extend({
      name: z.literal('model.decision.requested'),
      observationId: identifierSchema,
      historyCount: z.number().int().nonnegative().max(5),
      attempt: z.number().int().min(1).max(4),
    })
    .strict(),

  base
    .extend({
      name: z.literal('model.decision.received'),
      decisionKind: z.enum(DISCOVERY_DECISION_KINDS),
      attempts: z.number().int().min(1).max(4),
    })
    .strict(),

  base
    .extend({
      name: z.literal('model.decision.invalid'),
      attempt: z.number().int().min(1).max(4),
      issues: z.array(messageSchema).min(1).max(10),
    })
    .strict(),

  base
    .extend({
      name: z.literal('policy.evaluated'),
      actionKind: policyActionKindSchema,
      riskLevel: riskLevelSchema,
      decision: policyDecisionKindSchema,
    })
    .strict(),

  base
    .extend({
      name: z.literal('target.resolved'),
      status: z.enum(['resolved', 'failure']),
      attemptCount: z.number().int().nonnegative().max(100),
      errorCode: identifierSchema.nullable(),
    })
    .strict(),

  base
    .extend({
      name: z.literal('action.started'),
      actionId: identifierSchema,
      actionKind: policyActionKindSchema,
    })
    .strict(),

  base
    .extend({
      name: z.literal('action.completed'),
      actionId: identifierSchema,
      actionKind: policyActionKindSchema,
      evidenceRefs: evidenceRefsSchema,
    })
    .strict(),

  base
    .extend({
      name: z.literal('action.failed'),
      actionId: identifierSchema,
      actionKind: policyActionKindSchema,
      errorCode: identifierSchema,
      evidenceRefs: evidenceRefsSchema,
    })
    .strict(),

  base
    .extend({
      name: z.literal('value.extracted'),
      outputName: identifierSchema,
      source: z.literal('surface_read'),
      evidenceRefs: evidenceRefsSchema,
    })
    .strict(),

  base
    .extend({
      name: z.literal('stuck.detected'),
      repeatedStateCount: z.number().int().positive(),
      threshold: z.number().int().positive(),
    })
    .strict(),

  base
    .extend({
      name: z.literal('discovery.completed'),
      outputNames: z.array(identifierSchema).max(100),
    })
    .strict(),

  base
    .extend({
      name: z.literal('discovery.business_outcome'),
      outcomeCode: identifierSchema,
    })
    .strict(),

  base
    .extend({
      name: z.literal('discovery.failed'),
      errorCode: identifierSchema,
    })
    .strict(),

  base
    .extend({
      name: z.literal('discovery.escalated'),
      reasonCode: identifierSchema,
      source: identifierSchema,
    })
    .strict(),
]);

export type DiscoveryEvidenceEvent = z.infer<typeof discoveryEvidenceEventSchema>;

export interface DiscoveryEvidenceEventSink {
  recordEvent(input: RecordEventInput): Promise<void>;
}

export function parseDiscoveryEvidenceEvent(value: unknown): DiscoveryEvidenceEvent {
  return discoveryEvidenceEventSchema.parse(value);
}

/**
 * Persists only a strict event envelope.
 * Raw model-provider payloads are not accepted.
 */
export function recordDiscoveryEvidenceEvent(
  sink: DiscoveryEvidenceEventSink,
  input: unknown,
): Promise<void> {
  const event = parseDiscoveryEvidenceEvent(input);

  const evidenceRefs =
    event.name === 'observation.captured' ||
    event.name === 'action.completed' ||
    event.name === 'action.failed' ||
    event.name === 'value.extracted'
      ? event.evidenceRefs
      : [];

  return sink.recordEvent({
    step: event.step,
    eventType: event.name,
    result: event,
    evidenceRefs,
  });
}
