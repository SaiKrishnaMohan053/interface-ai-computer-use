import { z } from 'zod';

import {
  interventionAcquisitionSchema,
  interventionRequestSchema,
  interventionSourceSchema,
  interventionStatusSchema,
} from './intervention-types.js';

import type {
  InterventionAcquisition,
  InterventionRequest,
  InterventionSource,
  InterventionStatus,
} from './intervention-types.js';

export const OPERATOR_COMMAND_KINDS = ['list', 'show', 'acquire', 'start'] as const;

export const operatorCommandKindSchema = z.enum(OPERATOR_COMMAND_KINDS);

export type OperatorCommandKind = z.infer<typeof operatorCommandKindSchema>;

const identifierSchema = z.string().trim().min(1).max(500);

export const operatorCommandSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('list'),
    })
    .strict(),

  z
    .object({
      kind: z.literal('show'),

      interventionId: identifierSchema,
    })
    .strict(),

  z
    .object({
      kind: z.literal('acquire'),

      interventionId: identifierSchema,

      acquisitionId: identifierSchema,

      operatorId: identifierSchema.optional(),
    })
    .strict(),

  z
    .object({
      kind: z.literal('start'),

      interventionId: identifierSchema,
    })
    .strict(),
]);

export type OperatorCommand = z.infer<typeof operatorCommandSchema>;

export const operatorInterventionViewSchema = z
  .object({
    id: identifierSchema,

    status: interventionStatusSchema,

    source: interventionSourceSchema,

    reasonCode: interventionRequestSchema.shape.reasonCode,

    reason: interventionRequestSchema.shape.reason,

    capabilityId: interventionRequestSchema.shape.capabilityId,

    capabilityVersion: interventionRequestSchema.shape.capabilityVersion,

    goal: interventionRequestSchema.shape.goal,

    stepId: interventionRequestSchema.shape.stepId,

    observedState: interventionRequestSchema.shape.observedState,

    evidenceRefs: interventionRequestSchema.shape.evidenceRefs,

    acquisition: interventionAcquisitionSchema.optional(),
  })
  .strict();

export interface OperatorInterventionView {
  id: string;

  status: InterventionStatus;

  source: InterventionSource;

  reasonCode: InterventionRequest['reasonCode'];

  reason: string;

  capabilityId?: string | undefined;

  capabilityVersion?: string | undefined;

  goal?: string | undefined;

  stepId?: string | undefined;

  observedState: string;

  evidenceRefs: InterventionRequest['evidenceRefs'];

  acquisition?: InterventionAcquisition | undefined;
}

export function parseOperatorCommand(value: unknown): OperatorCommand {
  return operatorCommandSchema.parse(value);
}

export function parseOperatorInterventionView(value: unknown): OperatorInterventionView {
  return operatorInterventionViewSchema.parse(value);
}

export function toOperatorInterventionView(input: {
  request: InterventionRequest;
  acquisition?: InterventionAcquisition | undefined;
}): OperatorInterventionView {
  return operatorInterventionViewSchema.parse({
    id: input.request.id,

    status: input.request.status,

    source: input.request.source,

    reasonCode: input.request.reasonCode,

    reason: input.request.reason,

    ...(input.request.capabilityId === undefined
      ? {}
      : {
          capabilityId: input.request.capabilityId,
        }),

    ...(input.request.capabilityVersion === undefined
      ? {}
      : {
          capabilityVersion: input.request.capabilityVersion,
        }),

    ...(input.request.goal === undefined
      ? {}
      : {
          goal: input.request.goal,
        }),

    ...(input.request.stepId === undefined
      ? {}
      : {
          stepId: input.request.stepId,
        }),

    observedState: input.request.observedState,

    evidenceRefs: input.request.evidenceRefs,

    ...(input.acquisition === undefined
      ? {}
      : {
          acquisition: input.acquisition,
        }),
  });
}
