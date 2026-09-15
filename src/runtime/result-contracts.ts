import { z } from 'zod';

export const BUSINESS_OUTCOME_CODES = ['MEMBER_NOT_FOUND', 'PERMISSION_DENIED'] as const;

export const RECOVERABLE_CONDITION_CODES = [
  'TRANSIENT_LOAD',
  'KNOWN_DIALOG',
  'KNOWN_INTERSTITIAL',
] as const;

export const RUNTIME_FAILURE_CODES = [
  'TARGET_NOT_FOUND',
  'TARGET_AMBIGUOUS',
  'CHECKPOINT_FAILED',
  'SESSION_EXPIRED_UNRECOVERABLE',
  'APPLICATION_ERROR',
  'NAVIGATION_FAILED',
  'ACTION_FAILED',
  'POLICY_DENIED',
  'INVALID_INPUT',
  'RUN_TIMEOUT',
  'MODEL_REQUEST_FAILED',
  'MODEL_DECISION_VALIDATION_FAILED',
] as const;

export const INTERVENTION_REASON_CODES = [
  'HUMAN_APPROVAL_REQUIRED',
  'AUTOMATION_STUCK',
  'RECOVERY_EXHAUSTED',
] as const;

export const businessOutcomeCodeSchema = z.enum(BUSINESS_OUTCOME_CODES);

export const recoverableConditionCodeSchema = z.enum(RECOVERABLE_CONDITION_CODES);

export const runtimeFailureCodeSchema = z.enum(RUNTIME_FAILURE_CODES);

export const interventionReasonCodeSchema = z.enum(INTERVENTION_REASON_CODES);

export type BusinessOutcomeCode = z.infer<typeof businessOutcomeCodeSchema>;

export type RecoverableConditionCode = z.infer<typeof recoverableConditionCodeSchema>;

export type RuntimeFailureCode = z.infer<typeof runtimeFailureCodeSchema>;

export type InterventionReasonCode = z.infer<typeof interventionReasonCodeSchema>;

const identifier = z.string().trim().min(1).max(500);
const message = z.string().trim().min(1).max(10_000);
const timestamp = z.iso.datetime({ offset: true });
const details = z.record(z.string(), z.json());

export const runtimeEvidenceReferenceSchema = z
  .object({
    evidenceId: identifier,
    runId: identifier,
    kind: z.enum(['screenshot', 'trace', 'snapshot', 'event_log']),
    relativePath: identifier,
    mediaType: identifier,
    capturedAt: timestamp,
  })
  .strict();

const recoverableConditionBaseSchema = z.object({
  message,
  detectedAt: timestamp,
  details,
});

export const recoverableConditionSchema = z.discriminatedUnion('code', [
  recoverableConditionBaseSchema
    .extend({
      code: z.literal('TRANSIENT_LOAD'),
      recovery: z.literal('wait-and-retry'),
      attempt: z.number().int().positive(),
      maxAttempts: z.number().int().positive(),
    })
    .strict()
    .refine((value) => value.attempt <= value.maxAttempts, {
      message: 'Transient-load attempt cannot exceed maxAttempts',
      path: ['attempt'],
    }),

  recoverableConditionBaseSchema
    .extend({
      code: z.literal('KNOWN_DIALOG'),
      recovery: z.literal('dismiss'),
      dialogId: identifier,
    })
    .strict(),

  recoverableConditionBaseSchema
    .extend({
      code: z.literal('KNOWN_INTERSTITIAL'),
      recovery: z.literal('continue'),
      dialogId: identifier,
    })
    .strict(),
]);

export type RecoverableCondition = z.infer<typeof recoverableConditionSchema>;

const runtimeResultBaseSchema = z
  .object({
    runId: identifier,
    sessionId: identifier,
    startedAt: timestamp,
    finishedAt: timestamp,
    durationMs: z.number().finite().nonnegative(),
    evidenceRefs: z.array(runtimeEvidenceReferenceSchema),
    recoverableConditions: z.array(recoverableConditionSchema),
  })
  .strict();

export const runtimeSuccessSchema = runtimeResultBaseSchema.extend({
  status: z.literal('success'),
  outputs: z.record(z.string().trim().min(1), z.json()),
});

export const runtimeBusinessOutcomeSchema = runtimeResultBaseSchema.extend({
  status: z.literal('business_outcome'),
  outcome: z
    .object({
      code: businessOutcomeCodeSchema,
      message,
      details,
    })
    .strict(),
});

export const runtimeInterventionRequiredSchema = runtimeResultBaseSchema.extend({
  status: z.literal('intervention_required'),
  intervention: z
    .object({
      interventionId: identifier,
      code: interventionReasonCodeSchema,
      message,
      requestedOwner: z.literal('HUMAN'),
      resumable: z.boolean(),
      context: details,
    })
    .strict(),
});

export const runtimeFailureSchema = runtimeResultBaseSchema.extend({
  status: z.literal('failure'),
  error: z
    .object({
      code: runtimeFailureCodeSchema,
      message,
      stepId: identifier.nullable(),
      expected: z.json(),
      observed: z.json(),
      details,
    })
    .strict(),
});

export const runtimeResultSchema = z
  .discriminatedUnion('status', [
    runtimeSuccessSchema,
    runtimeBusinessOutcomeSchema,
    runtimeInterventionRequiredSchema,
    runtimeFailureSchema,
  ])
  .superRefine((result, context) => {
    if (Date.parse(result.finishedAt) < Date.parse(result.startedAt)) {
      context.addIssue({
        code: 'custom',
        message: 'finishedAt must not be earlier than startedAt',
        path: ['finishedAt'],
      });
    }
  });

export type RuntimeSuccess = z.infer<typeof runtimeSuccessSchema>;

export type RuntimeBusinessOutcome = z.infer<typeof runtimeBusinessOutcomeSchema>;

export type RuntimeInterventionRequired = z.infer<typeof runtimeInterventionRequiredSchema>;

export type RuntimeFailure = z.infer<typeof runtimeFailureSchema>;

export type RuntimeResult = z.infer<typeof runtimeResultSchema>;

export function parseRuntimeResult(value: unknown): RuntimeResult {
  return runtimeResultSchema.parse(value);
}

export function parseRecoverableCondition(value: unknown): RecoverableCondition {
  return recoverableConditionSchema.parse(value);
}
