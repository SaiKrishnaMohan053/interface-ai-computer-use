import { z } from 'zod';

const capabilityIdSchema = z
  .string()
  .min(1, 'Capability ID must not be empty')
  .max(200, 'Capability ID is too long')
  .regex(/^[a-z][a-z0-9_]*$/, 'Capability ID must use lowercase snake_case');

const capabilityVersionSchema = z
  .string()
  .min(1, 'Capability version must not be empty')
  .max(100, 'Capability version is too long')
  .regex(/^\d+\.\d+\.\d+$/, 'Capability version must use MAJOR.MINOR.PATCH format');

const replayEntryUrlSchema = z
  .string()
  .trim()
  .url()
  .superRefine((value, context) => {
    let url: URL;

    try {
      url = new URL(value);
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'Replay entry URL is invalid',
      });

      return;
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
      context.addIssue({
        code: 'custom',
        message: 'Replay entry URL must use HTTP or HTTPS',
      });
    }

    if (url.username.length > 0 || url.password.length > 0) {
      context.addIssue({
        code: 'custom',
        message: 'Replay entry URL must not contain credentials',
      });
    }
  });

export const replayOptionsSchema = z
  .object({
    timeoutMs: z.number().finite().positive().optional(),
  })
  .strict();

export const replayTargetSchema = z
  .object({
    entryUrl: replayEntryUrlSchema.optional(),
  })
  .strict();

export const replayRequestSchema = z
  .object({
    capabilityId: capabilityIdSchema,

    version: capabilityVersionSchema,

    inputs: z.record(z.string().trim().min(1), z.unknown()),

    target: replayTargetSchema.optional(),

    options: replayOptionsSchema.optional(),
  })
  .strict();

export type ReplayOptions = z.infer<typeof replayOptionsSchema>;

export type ReplayTarget = z.infer<typeof replayTargetSchema>;

export type ReplayRequest = z.infer<typeof replayRequestSchema>;

export function parseReplayRequest(value: unknown): ReplayRequest {
  return replayRequestSchema.parse(value);
}
