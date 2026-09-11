import { z } from 'zod';

export const AGENT_TARGET_STRATEGY_KINDS = ['role-name', 'label', 'text', 'structural'] as const;

export const DISCOVERY_DECISION_KINDS = [
  'click',
  'type',
  'select',
  'check',
  'uncheck',
  'navigate',
  'read',
  'wait',
  'dismiss',
  'complete',
  'escalate',
] as const;

const boundedText = (field: string, maximum: number) =>
  z.string().trim().min(1, `${field} must not be empty`).max(maximum, `${field} is too long`);

const decisionReasonSchema = boundedText('Decision reason', 2_000);

const outputNameSchema = z
  .string()
  .trim()
  .min(1, 'Output name must not be empty')
  .max(200, 'Output name is too long')
  .regex(
    /^[a-zA-Z][a-zA-Z0-9_]*$/,
    'Output name must begin with a letter and contain only letters, numbers, and underscores',
  );

export const agentTargetTextMatchSchema = z
  .object({
    value: boundedText('Match value', 500),
    mode: z.enum(['exact', 'contains']),
    caseSensitive: z.boolean(),
  })
  .strict();

const roleNameStrategySchema = z
  .object({
    kind: z.literal('role-name'),
    role: boundedText('Role', 100),
    name: agentTargetTextMatchSchema,
  })
  .strict();

const labelStrategySchema = z
  .object({
    kind: z.literal('label'),
    label: agentTargetTextMatchSchema,
  })
  .strict();

const textStrategySchema = z
  .object({
    kind: z.literal('text'),
    text: agentTargetTextMatchSchema,
  })
  .strict();

const structuralAnchorSchema = z
  .object({
    role: boundedText('Anchor role', 100).optional(),
    name: agentTargetTextMatchSchema.optional(),
    text: agentTargetTextMatchSchema.optional(),
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

    name: agentTargetTextMatchSchema.optional(),

    text: agentTargetTextMatchSchema.optional(),

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
          name: agentTargetTextMatchSchema,
        })
        .strict(),

      row: z
        .object({
          columnHeader: agentTargetTextMatchSchema,

          value: agentTargetTextMatchSchema,
        })
        .strict(),

      column: z
        .object({
          header: agentTargetTextMatchSchema,
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

/**
 * Model-facing targeting intentionally excludes CSS and XPath.
 * Runtime TargetSpec can continue supporting them for compiled artifacts.
 */
export const agentTargetStrategySchema = z.discriminatedUnion('kind', [
  roleNameStrategySchema,
  labelStrategySchema,
  textStrategySchema,
  structuralStrategySchema,
]);

export const agentTargetSpecSchema = z
  .object({
    description: boundedText('Target description', 500),

    strategies: z.array(agentTargetStrategySchema).min(1).max(8),

    cardinality: z.literal('exactly-one'),
  })
  .strict();

export const agentConditionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('elementVisible'),
      target: agentTargetSpecSchema,
    })
    .strict(),

  z
    .object({
      kind: z.literal('elementAbsent'),
      target: agentTargetSpecSchema,
    })
    .strict(),

  z
    .object({
      kind: z.literal('textPresent'),
      text: boundedText('Condition text', 10_000),
      match: z.enum(['exact', 'contains']),
      caseSensitive: z.boolean(),
    })
    .strict(),

  z
    .object({
      kind: z.literal('urlMatches'),

      match: z.discriminatedUnion('kind', [
        z
          .object({
            kind: z.literal('exact'),
            value: boundedText('URL', 2_000),
          })
          .strict(),

        z
          .object({
            kind: z.literal('pathname'),

            value: boundedText('Pathname', 2_000).refine((value) => value.startsWith('/'), {
              message: 'A pathname must begin with /',
            }),
          })
          .strict(),
      ]),
    })
    .strict(),

  z
    .object({
      kind: z.literal('valueEquals'),
      target: agentTargetSpecSchema,
      expected: z.string().max(100_000),
    })
    .strict(),

  z
    .object({
      kind: z.literal('loadingComplete'),
    })
    .strict(),
]);

const clickDecisionSchema = z
  .object({
    kind: z.literal('click'),
    target: agentTargetSpecSchema,
    reason: decisionReasonSchema,
  })
  .strict();

const typeDecisionSchema = z
  .object({
    kind: z.literal('type'),
    target: agentTargetSpecSchema,
    text: z.string().max(100_000),
    mode: z.enum(['replace', 'append']),
    reason: decisionReasonSchema,
  })
  .strict();

const selectDecisionSchema = z
  .object({
    kind: z.literal('select'),
    target: agentTargetSpecSchema,

    option: z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('label'),
          label: boundedText('Option label', 1_000),
        })
        .strict(),

      z
        .object({
          kind: z.literal('value'),
          value: boundedText('Option value', 1_000),
        })
        .strict(),
    ]),

    reason: decisionReasonSchema,
  })
  .strict();

const checkDecisionSchema = z
  .object({
    kind: z.literal('check'),
    target: agentTargetSpecSchema,
    reason: decisionReasonSchema,
  })
  .strict();

const uncheckDecisionSchema = z
  .object({
    kind: z.literal('uncheck'),
    target: agentTargetSpecSchema,
    reason: decisionReasonSchema,
  })
  .strict();

const navigationDestinationSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .url('Navigation destination must be valid')
  .superRefine((value, context) => {
    if (!URL.canParse(value)) {
      return;
    }

    const url = new URL(value);

    if (!['http:', 'https:'].includes(url.protocol)) {
      context.addIssue({
        code: 'custom',
        message: 'Navigation must use HTTP or HTTPS',
      });
    }

    if (url.username.length > 0 || url.password.length > 0) {
      context.addIssue({
        code: 'custom',
        message: 'Navigation URL must not contain credentials',
      });
    }
  });

const navigateDecisionSchema = z
  .object({
    kind: z.literal('navigate'),
    destination: navigationDestinationSchema,
    reason: decisionReasonSchema,
  })
  .strict();

const readDecisionSchema = z
  .object({
    kind: z.literal('read'),
    target: agentTargetSpecSchema,
    source: z.enum(['text', 'value']),
    saveAs: outputNameSchema,
    reason: decisionReasonSchema,
  })
  .strict();

const waitDecisionSchema = z
  .object({
    kind: z.literal('wait'),
    condition: agentConditionSchema,
    reason: decisionReasonSchema,
  })
  .strict();

const nativeDismissSchema = z
  .object({
    kind: z.literal('native'),
    observationId: boundedText('Observation ID', 500),
    dialogId: boundedText('Dialog ID', 500),

    response: z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('dismiss'),
        })
        .strict(),

      z
        .object({
          kind: z.literal('accept'),
          promptText: z.string().max(10_000).optional(),
        })
        .strict(),
    ]),
  })
  .strict();

const surfaceDismissSchema = z
  .object({
    kind: z.literal('surface'),
    target: agentTargetSpecSchema,
  })
  .strict();

const dismissDecisionSchema = z
  .object({
    kind: z.literal('dismiss'),

    dialog: z.discriminatedUnion('kind', [nativeDismissSchema, surfaceDismissSchema]),

    reason: decisionReasonSchema,
  })
  .strict();

const completeDecisionSchema = z
  .object({
    kind: z.literal('complete'),

    summary: boundedText('Completion summary', 4_000),

    outputs: z.record(outputNameSchema, z.json()),
  })
  .strict();

const escalateDecisionSchema = z
  .object({
    kind: z.literal('escalate'),

    /*
     * HUMAN_APPROVAL_REQUIRED belongs to PolicyEngine.
     * The model cannot manufacture a policy decision.
     */
    reasonCode: z.enum(['AUTOMATION_STUCK', 'RECOVERY_EXHAUSTED']),

    reason: decisionReasonSchema,
  })
  .strict();

export const discoveryDecisionSchema = z.discriminatedUnion('kind', [
  clickDecisionSchema,
  typeDecisionSchema,
  selectDecisionSchema,
  checkDecisionSchema,
  uncheckDecisionSchema,
  navigateDecisionSchema,
  readDecisionSchema,
  waitDecisionSchema,
  dismissDecisionSchema,
  completeDecisionSchema,
  escalateDecisionSchema,
]);

export type AgentTargetTextMatch = z.infer<typeof agentTargetTextMatchSchema>;

export type AgentTargetStrategy = z.infer<typeof agentTargetStrategySchema>;

export type AgentTargetSpec = z.infer<typeof agentTargetSpecSchema>;

export type AgentCondition = z.infer<typeof agentConditionSchema>;

export type DiscoveryDecision = z.infer<typeof discoveryDecisionSchema>;

export type DiscoveryCompletion = Extract<DiscoveryDecision, { readonly kind: 'complete' }>;

export function parseDiscoveryDecision(value: unknown): DiscoveryDecision {
  return discoveryDecisionSchema.parse(value);
}
