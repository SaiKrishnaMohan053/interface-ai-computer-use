import { z } from 'zod';
import { targetSpecSchema } from '../targeting/target-spec.js';

const conditionText = z.string().min(1, 'Condition text must not be empty').max(10_000);

const targetConditionSchemas = [
  z
    .object({
      kind: z.literal('elementVisible'),
      target: targetSpecSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('elementAbsent'),
      target: targetSpecSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('valueEquals'),
      target: targetSpecSchema,
      expected: z.string().max(100_000),
    })
    .strict(),
] as const;

export const conditionSpecSchema = z.discriminatedUnion('kind', [
  ...targetConditionSchemas,
  z
    .object({
      kind: z.literal('textPresent'),
      text: conditionText,
      match: z.enum(['exact', 'contains']),
      caseSensitive: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('urlMatches'),
      match: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('exact'), value: conditionText }).strict(),
        z
          .object({
            kind: z.literal('pathname'),
            value: conditionText.refine((value) => value.startsWith('/'), {
              message: 'A pathname condition must begin with /',
            }),
          })
          .strict(),
      ]),
    })
    .strict(),
  z.object({ kind: z.literal('loadingComplete') }).strict(),
]);

export type ConditionSpec = z.infer<typeof conditionSpecSchema>;

export function parseConditionSpec(value: unknown): ConditionSpec {
  return conditionSpecSchema.parse(value);
}
