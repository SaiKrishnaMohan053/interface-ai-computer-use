import { z } from 'zod';

const boundedText = (field: string, maximum: number) =>
  z.string().trim().min(1, `${field} must not be empty`).max(maximum, `${field} is too long`);

export const targetTextMatchSchema = z
  .object({
    value: boundedText('Match value', 500),
    mode: z.enum(['exact', 'contains']),
    caseSensitive: z.boolean(),
  })
  .strict();

export type TargetTextMatch = z.infer<typeof targetTextMatchSchema>;

const roleNameStrategySchema = z
  .object({
    kind: z.literal('role-name'),
    role: boundedText('Role', 100),
    name: targetTextMatchSchema,
  })
  .strict();

const labelStrategySchema = z
  .object({
    kind: z.literal('label'),
    label: targetTextMatchSchema,
  })
  .strict();

const textStrategySchema = z
  .object({
    kind: z.literal('text'),
    text: targetTextMatchSchema,
  })
  .strict();

const structuralAnchorSchema = z
  .object({
    role: boundedText('Anchor role', 100).optional(),

    name: targetTextMatchSchema.optional(),

    text: targetTextMatchSchema.optional(),
  })
  .strict()
  .refine(
    (anchor) => anchor.role !== undefined || anchor.name !== undefined || anchor.text !== undefined,
    {
      message: 'A structural anchor requires a role, accessible name, or text',
    },
  );

const structuralDescendantSchema = z
  .object({
    role: boundedText('Descendant role', 100).optional(),

    name: targetTextMatchSchema.optional(),

    text: targetTextMatchSchema.optional(),

    zeroBasedIndex: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine(
    (target) => target.role !== undefined || target.name !== undefined || target.text !== undefined,
    {
      message: 'A structural descendant requires a role, accessible name, or text',
    },
  );

const structuralQuerySchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('table-cell'),

      table: z
        .object({
          name: targetTextMatchSchema,
        })
        .strict(),

      row: z
        .object({
          columnHeader: targetTextMatchSchema,

          value: targetTextMatchSchema,
        })
        .strict(),

      column: z
        .object({
          header: targetTextMatchSchema,
        })
        .strict(),
    })
    .strict(),

  z
    .object({
      kind: z.literal('within'),
      container: structuralAnchorSchema,
      target: structuralDescendantSchema,
    })
    .strict(),
]);

const structuralStrategySchema = z
  .object({
    kind: z.literal('structural'),
    query: structuralQuerySchema,
  })
  .strict();

const cssStrategySchema = z
  .object({
    kind: z.literal('css'),
    selector: boundedText('CSS selector', 2_000),
  })
  .strict();

const xpathStrategySchema = z
  .object({
    kind: z.literal('xpath'),
    expression: boundedText('XPath expression', 2_000),
  })
  .strict();

/**
 * Declarative locator strategies.
 * These contain no Playwright objects.
 *
 * Accessibility and structural strategies should normally
 * precede CSS and XPath.
 */
export const targetStrategySchema = z.discriminatedUnion('kind', [
  roleNameStrategySchema,
  labelStrategySchema,
  textStrategySchema,
  structuralStrategySchema,
  cssStrategySchema,
  xpathStrategySchema,
]);

export type TargetStrategy = z.infer<typeof targetStrategySchema>;

/**
 * Array order is fallback order.
 * Resolution succeeds only for exactly one match.
 */
export const targetSpecSchema = z
  .object({
    description: boundedText('Target description', 500),

    strategies: z.array(targetStrategySchema).min(1).max(12),

    cardinality: z.literal('exactly-one'),
  })
  .strict();

export type TargetSpec = z.infer<typeof targetSpecSchema>;

export function parseTargetSpec(value: unknown): TargetSpec {
  return targetSpecSchema.parse(value);
}
