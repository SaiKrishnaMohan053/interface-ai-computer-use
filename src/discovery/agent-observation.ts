import { z } from 'zod';

const MAX_GOAL_LENGTH = 4_000;
const MAX_SUMMARY_LENGTH = 20_000;
const MAX_FIELD_LENGTH = 2_000;
const MAX_CONTROLS = 200;
const MAX_DIALOGS = 20;
const MAX_CONTEXT_HINTS = 20;
const MAX_OPTIONS = 200;

const optionalTextSchema = z.string().max(MAX_FIELD_LENGTH).nullable();

const httpUrlSchema = z
  .string()
  .max(MAX_FIELD_LENGTH)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Expected an HTTP or HTTPS URL');

export const agentWebLocationSchema = z
  .object({
    kind: z.literal('web'),
    url: httpUrlSchema,
    title: z.string().max(MAX_FIELD_LENGTH),
  })
  .strict();

export const agentApplicationLocationSchema = z
  .object({
    kind: z.literal('application'),
    applicationId: z.string().min(1).max(MAX_FIELD_LENGTH),
    windowTitle: z.string().max(MAX_FIELD_LENGTH),
  })
  .strict();

export const agentLocationSchema = z.discriminatedUnion('kind', [
  agentWebLocationSchema,
  agentApplicationLocationSchema,
]);

const agentControlBaseSchema = z.object({
  role: z.string().max(200).nullable(),
  accessibleName: z.string().max(MAX_FIELD_LENGTH),
  label: optionalTextSchema,
  visibleText: optionalTextSchema,
  enabled: z.boolean(),
  context: optionalTextSchema,
});

export const agentSelectOptionSchema = z
  .object({
    label: z.string().max(MAX_FIELD_LENGTH),
    value: z.string().max(MAX_FIELD_LENGTH).nullable(),
    selected: z.boolean(),
    enabled: z.boolean(),
  })
  .strict();

export const agentControlSchema = z.discriminatedUnion('kind', [
  agentControlBaseSchema
    .extend({
      kind: z.literal('button'),
    })
    .strict(),

  agentControlBaseSchema
    .extend({
      kind: z.literal('link'),
      destination: optionalTextSchema,
    })
    .strict(),

  agentControlBaseSchema
    .extend({
      kind: z.literal('text_input'),
      inputType: z.string().max(200),
      value: optionalTextSchema,
      readOnly: z.boolean(),
    })
    .strict(),

  agentControlBaseSchema
    .extend({
      kind: z.literal('select'),
      multiple: z.boolean(),
      options: z.array(agentSelectOptionSchema).max(MAX_OPTIONS),
    })
    .strict(),

  agentControlBaseSchema
    .extend({
      kind: z.literal('checkbox'),
      checked: z.boolean(),
      indeterminate: z.boolean(),
    })
    .strict(),

  agentControlBaseSchema
    .extend({
      kind: z.literal('radio'),
      checked: z.boolean(),
    })
    .strict(),

  agentControlBaseSchema
    .extend({
      kind: z.literal('other'),
      value: optionalTextSchema,
    })
    .strict(),
]);

export const agentNativeDialogSchema = z
  .object({
    kind: z.literal('native'),
    dialogId: z.string().min(1).max(500),
    type: z.enum(['alert', 'confirm', 'prompt', 'beforeunload']),
    message: z.string().max(MAX_FIELD_LENGTH),
    defaultValue: optionalTextSchema,
  })
  .strict();

export const agentSurfaceDialogSchema = z
  .object({
    kind: z.literal('surface'),
    dialogId: z.string().min(1).max(500),
    presentation: z.enum(['dialog', 'modal', 'popover', 'interstitial', 'unknown']),
    title: optionalTextSchema,
    text: z.string().max(MAX_SUMMARY_LENGTH),
    controlNames: z.array(z.string().max(MAX_FIELD_LENGTH)).max(MAX_CONTROLS),
  })
  .strict();

export const agentDialogSchema = z.discriminatedUnion('kind', [
  agentNativeDialogSchema,
  agentSurfaceDialogSchema,
]);

export const agentActionKindSchema = z.enum([
  'click',
  'type',
  'select',
  'check',
  'uncheck',
  'navigate',
  'read',
  'wait',
  'dismiss',
]);

export const agentActionOutcomeSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('success'),
      actionKind: agentActionKindSchema,
      summary: z.string().max(MAX_FIELD_LENGTH),
      output: z.json().nullable(),
    })
    .strict(),

  z
    .object({
      status: z.literal('failure'),
      actionKind: agentActionKindSchema,
      summary: z.string().max(MAX_FIELD_LENGTH),
      errorCode: z.string().min(1).max(200),
      recoverable: z.boolean(),
    })
    .strict(),
]);

export const agentConditionOutcomeSchema = z
  .object({
    status: z.enum(['passed', 'not_met', 'error']),
    conditionKind: z.string().min(1).max(200),
    summary: z.string().max(MAX_FIELD_LENGTH),
  })
  .strict();

export const agentErrorSchema = z
  .object({
    code: z.string().min(1).max(200),
    message: z.string().max(MAX_FIELD_LENGTH),
    recoverable: z.boolean(),
  })
  .strict();

export const agentObservationSchema = z
  .object({
    goal: z.string().min(1).max(MAX_GOAL_LENGTH),
    step: z.number().int().nonnegative(),

    observationId: z.string().min(1).max(500),
    capturedAt: z.iso.datetime({ offset: true }),

    location: agentLocationSchema,
    visibleTextSummary: z.string().max(MAX_SUMMARY_LENGTH),

    controls: z.array(agentControlSchema).max(MAX_CONTROLS),
    dialogs: z.array(agentDialogSchema).max(MAX_DIALOGS),

    contextHints: z
      .object({
        frames: z.array(z.string().max(MAX_FIELD_LENGTH)).max(MAX_CONTEXT_HINTS),
        regions: z.array(z.string().max(MAX_FIELD_LENGTH)).max(MAX_CONTEXT_HINTS),
      })
      .strict(),

    loading: z.enum(['loading', 'complete', 'unknown']),

    truncated: z
      .object({
        visibleText: z.boolean(),
        controls: z.boolean(),
      })
      .strict(),

    extractedValues: z.record(z.string().min(1).max(500), z.json()),

    recentAction: agentActionOutcomeSchema.nullable(),
    recentCondition: agentConditionOutcomeSchema.nullable(),
    recentError: agentErrorSchema.nullable(),
  })
  .strict();

export type AgentLocation = z.infer<typeof agentLocationSchema>;
export type AgentControl = z.infer<typeof agentControlSchema>;
export type AgentDialog = z.infer<typeof agentDialogSchema>;
export type AgentActionOutcome = z.infer<typeof agentActionOutcomeSchema>;
export type AgentConditionOutcome = z.infer<typeof agentConditionOutcomeSchema>;
export type AgentError = z.infer<typeof agentErrorSchema>;
export type AgentObservation = z.infer<typeof agentObservationSchema>;
export type AgentActionKind = z.infer<typeof agentActionKindSchema>;

export function parseAgentObservation(value: unknown): AgentObservation {
  return agentObservationSchema.parse(value);
}
