import { z } from 'zod';

export const DEFAULT_DISCOVERY_MAX_STEPS = 20;
export const DEFAULT_DISCOVERY_TIMEOUT_MS = 120_000;

const goalSchema = z
  .string()
  .trim()
  .min(1, 'Discovery goal must not be empty')
  .max(4_000, 'Discovery goal is too long');

const applicationSchema = z
  .string()
  .trim()
  .min(1, 'Target application must not be empty')
  .max(200, 'Target application name is too long');

const entryUrlSchema = z
  .string()
  .trim()
  .min(1, 'Target entry URL must not be empty')
  .max(2_000, 'Target entry URL is too long')
  .url('Target entry URL must be valid')
  .superRefine((value, context) => {
    /*
     * Zod can continue into superRefine after the URL
     * format check reports an issue. Avoid throwing while
     * validating malformed external input.
     */
    if (!URL.canParse(value)) {
      return;
    }

    const url = new URL(value);

    if (!['http:', 'https:'].includes(url.protocol)) {
      context.addIssue({
        code: 'custom',
        message: 'Target entry URL must use HTTP or HTTPS',
      });
    }

    if (url.username.length > 0 || url.password.length > 0) {
      context.addIssue({
        code: 'custom',
        message: 'Target entry URL must not contain credentials',
      });
    }
  });

const parameterNameSchema = z
  .string()
  .trim()
  .min(1, 'Parameter name must not be empty')
  .max(200, 'Parameter name is too long');

export const discoveryLimitsSchema = z
  .object({
    maxSteps: z.number().int().min(1).max(100).optional(),

    timeoutMs: z
      .number()
      .int()
      .min(1_000)
      .max(15 * 60_000)
      .optional(),
  })
  .strict();

export const discoveryTargetSchema = z
  .object({
    entryUrl: entryUrlSchema,
    application: applicationSchema,
  })
  .strict();

export const discoveryRequestSchema = z
  .object({
    goal: goalSchema,

    target: discoveryTargetSchema,

    parameters: z.record(parameterNameSchema, z.json()).optional(),

    limits: discoveryLimitsSchema.optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.parameters !== undefined && Object.keys(request.parameters).length > 100) {
      context.addIssue({
        code: 'custom',
        message: 'Discovery request cannot contain more than 100 parameters',
        path: ['parameters'],
      });
    }
  });

export const discoveryRunConfigSchema = z
  .object({
    maxSteps: z.number().int().min(1).max(100),

    timeoutMs: z
      .number()
      .int()
      .min(1_000)
      .max(15 * 60_000),
  })
  .strict();

export type DiscoveryLimits = z.infer<typeof discoveryLimitsSchema>;

export type DiscoveryTarget = z.infer<typeof discoveryTargetSchema>;

export type DiscoveryRequest = z.infer<typeof discoveryRequestSchema>;

export type DiscoveryRunConfig = z.infer<typeof discoveryRunConfigSchema>;

export function parseDiscoveryRequest(value: unknown): DiscoveryRequest {
  return discoveryRequestSchema.parse(value);
}

export function resolveDiscoveryRunConfig(request: DiscoveryRequest): DiscoveryRunConfig {
  return discoveryRunConfigSchema.parse({
    maxSteps: request.limits?.maxSteps ?? DEFAULT_DISCOVERY_MAX_STEPS,

    timeoutMs: request.limits?.timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS,
  });
}
