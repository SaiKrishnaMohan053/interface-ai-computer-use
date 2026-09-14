import { z } from 'zod';

import type { RecordEventInput } from '../evidence/index.js';

import { policyActionKindSchema, policyDecisionSchema, riskLevelSchema } from '../policy/index.js';

import { runtimeEvidenceReferenceSchema } from '../runtime/index.js';

import { agentLocationSchema } from './agent-observation.js';

import { discoveryDecisionSchema } from './decision.js';

const stepSchema = z.number().int().nonnegative().max(100);

const textSchema = z.string().max(20_000);

const identifierSchema = z.string().trim().min(1).max(500);

const traceBaseSchema = z.object({
  step: stepSchema,
});

const resolutionAttemptSchema = z
  .object({
    strategyIndex: z.number().int().nonnegative(),

    strategyKind: z.string().trim().min(1).max(100),

    outcome: z.enum(['not-found', 'ambiguous', 'resolved', 'failure']),

    matchCount: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const discoveryTraceRecordSchema = z.discriminatedUnion('kind', [
  traceBaseSchema
    .extend({
      kind: z.literal('observation'),
      observationId: identifierSchema,
      location: agentLocationSchema,
      summary: textSchema,

      loading: z.enum(['loading', 'complete', 'unknown']),

      controlCount: z.number().int().nonnegative(),

      dialogCount: z.number().int().nonnegative(),
    })
    .strict(),

  traceBaseSchema
    .extend({
      kind: z.literal('model_decision'),

      decision: discoveryDecisionSchema,

      rationale: textSchema,
    })
    .strict(),

  traceBaseSchema
    .extend({
      kind: z.literal('policy_decision'),

      actionKind: policyActionKindSchema,

      systemRiskLevel: riskLevelSchema,

      policyDecision: policyDecisionSchema,
    })
    .strict(),

  traceBaseSchema
    .extend({
      kind: z.literal('target_resolution'),

      targetDescription: textSchema,

      status: z.enum(['resolved', 'failure']),

      attempts: z.array(resolutionAttemptSchema).max(100),

      errorCode: z.string().trim().min(1).max(200).nullable(),
    })
    .strict(),

  traceBaseSchema
    .extend({
      kind: z.literal('action_result'),

      /*
       * Action results contain only actionable
       * policy kinds. complete/escalate are
       * terminal decisions, not surface actions.
       */
      actionKind: policyActionKindSchema,

      status: z.enum(['success', 'failure']),

      errorCode: z.string().trim().min(1).max(200).nullable(),

      extractedValues: z.record(z.string().trim().min(1).max(500), z.json()),

      evidenceRefs: z.array(runtimeEvidenceReferenceSchema),
    })
    .strict(),

  traceBaseSchema
    .extend({
      kind: z.literal('condition_result'),

      conditionKind: z.string().trim().min(1).max(200),

      status: z.enum(['passed', 'not_met', 'error']),

      observed: z.json(),

      evidenceRefs: z.array(runtimeEvidenceReferenceSchema),
    })
    .strict(),

  traceBaseSchema
    .extend({
      kind: z.literal('runtime_event'),

      status: z.enum(['success', 'business_outcome', 'intervention_required', 'failure']),

      summary: textSchema,
    })
    .strict(),
]);

export type DiscoveryTraceRecord = z.infer<typeof discoveryTraceRecordSchema>;

export interface DiscoveryTraceSink {
  recordEvent(input: RecordEventInput): Promise<void>;
}

export function parseDiscoveryTraceRecord(value: unknown): DiscoveryTraceRecord {
  return discoveryTraceRecordSchema.parse(value);
}

/**
 * Persists one strict and concise discovery trace
 * record through the evidence log.
 */
export function recordDiscoveryTrace(sink: DiscoveryTraceSink, input: unknown): Promise<void> {
  const record = parseDiscoveryTraceRecord(input);

  return sink.recordEvent({
    step: record.step,
    eventType: 'discovery_trace',
    result: record,

    evidenceRefs:
      record.kind === 'action_result' || record.kind === 'condition_result'
        ? record.evidenceRefs
        : [],
  });
}

/**
 * Returns only the concise rationale explicitly
 * supplied by the model.
 *
 * Hidden model reasoning is never requested.
 */
export function discoveryDecisionRationale(
  decision: z.infer<typeof discoveryDecisionSchema>,
): string {
  return decision.kind === 'complete' ? decision.summary : decision.reason;
}
