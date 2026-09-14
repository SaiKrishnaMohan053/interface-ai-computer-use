import { z } from 'zod';

import {
  runtimeBusinessOutcomeSchema,
  runtimeFailureSchema,
  runtimeInterventionRequiredSchema,
  runtimeSuccessSchema,
} from '../runtime/index.js';

import type { RuntimeResult } from '../runtime/index.js';

const discoveryStepsSchema = z.number().int().nonnegative().max(100);

export const discoverySuccessResultSchema = runtimeSuccessSchema.extend({
  steps: discoveryStepsSchema,
});

export const discoveryBusinessOutcomeResultSchema = runtimeBusinessOutcomeSchema.extend({
  steps: discoveryStepsSchema,
});

export const discoveryInterventionRequiredResultSchema = runtimeInterventionRequiredSchema.extend({
  steps: discoveryStepsSchema,
});

export const discoveryFailureResultSchema = runtimeFailureSchema.extend({
  steps: discoveryStepsSchema,
});

/**
 * Public result of one discovery run.
 *
 * The strict runtime schemas expose only domain results
 * and evidence metadata. Provider SDK responses and
 * model reasoning are not part of this boundary.
 */
export const discoveryRunResultSchema = z
  .discriminatedUnion('status', [
    discoverySuccessResultSchema,
    discoveryBusinessOutcomeResultSchema,
    discoveryInterventionRequiredResultSchema,
    discoveryFailureResultSchema,
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

export type DiscoverySuccessResult = z.infer<typeof discoverySuccessResultSchema>;

export type DiscoveryBusinessOutcomeResult = z.infer<typeof discoveryBusinessOutcomeResultSchema>;

export type DiscoveryInterventionRequiredResult = z.infer<
  typeof discoveryInterventionRequiredResultSchema
>;

export type DiscoveryFailureResult = z.infer<typeof discoveryFailureResultSchema>;

export type DiscoveryRunResult = z.infer<typeof discoveryRunResultSchema>;

export function parseDiscoveryRunResult(value: unknown): DiscoveryRunResult {
  return discoveryRunResultSchema.parse(value);
}

/**
 * Adds discovery-only progress metadata to an already
 * validated runtime result.
 */
export function withDiscoverySteps(result: RuntimeResult, steps: number): DiscoveryRunResult {
  return parseDiscoveryRunResult({
    ...result,
    steps,
  });
}
