import { z } from 'zod';

export const POLICY_ACTION_KINDS = [
  'click',
  'type',
  'select',
  'check',
  'uncheck',
  'navigate',
  'read',
  'wait',
  'dismiss',
] as const;

export const RISK_LEVELS = ['READ_ONLY', 'REVERSIBLE', 'SENSITIVE_WRITE', 'IRREVERSIBLE'] as const;

export const POLICY_DECISIONS = ['ALLOW', 'DENY', 'REQUIRE_HUMAN'] as const;

export const policyActionKindSchema = z.enum(POLICY_ACTION_KINDS);

export const riskLevelSchema = z.enum(RISK_LEVELS);

export const policyDecisionKindSchema = z.enum(POLICY_DECISIONS);

export type PolicyActionKind = z.infer<typeof policyActionKindSchema>;

export type RiskLevel = z.infer<typeof riskLevelSchema>;

export type PolicyDecisionKind = z.infer<typeof policyDecisionKindSchema>;

const identifier = z.string().trim().min(1).max(200);

const description = z.string().trim().min(1).max(2_000);

const pathname = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .refine((value) => value.startsWith('/'), 'Route pathname must begin with /')
  .refine((value) => !value.includes('?') && !value.includes('#'), {
    message: 'Route pathname must not contain a query string or fragment',
  });

export const allowedOriginSchema = z
  .string()
  .trim()
  .url()
  .transform((value, context) => {
    const url = new URL(value);

    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.pathname !== '/' ||
      url.search.length > 0 ||
      url.hash.length > 0
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Allowed origin must contain only an HTTP(S) scheme, host, and optional port',
      });

      return z.NEVER;
    }

    return url.origin;
  });

export const routeMatchSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('exact'),
      pathname,
    })
    .strict(),

  z
    .object({
      kind: z.literal('prefix'),
      pathname,
    })
    .strict(),
]);

export const allowedRouteSchema = z
  .object({
    routeId: identifier,
    description,
    match: routeMatchSchema,
  })
  .strict();

export const riskRuleSchema = z
  .object({
    ruleId: identifier,
    description,

    match: z
      .object({
        actions: z.array(policyActionKindSchema).min(1),

        routeIds: z.array(identifier).min(1).optional(),
      })
      .strict(),

    riskLevel: riskLevelSchema,
    decision: policyDecisionKindSchema,
  })
  .strict()
  .superRefine((rule, context) => {
    if (
      (rule.riskLevel === 'SENSITIVE_WRITE' || rule.riskLevel === 'IRREVERSIBLE') &&
      rule.decision === 'ALLOW'
    ) {
      context.addIssue({
        code: 'custom',
        message: `${rule.riskLevel} actions must be denied ` + 'or require a human',
        path: ['decision'],
      });
    }
  });

export const policyConfigSchema = z
  .object({
    policyId: identifier,
    version: z.number().int().positive(),

    // Missing matches always deny.
    defaultDecision: z.literal('DENY'),

    allowedOrigins: z.array(allowedOriginSchema).min(1),

    allowedRoutes: z.array(allowedRouteSchema).min(1),

    allowedActions: z.array(policyActionKindSchema).min(1),

    // Array order is future policy evaluation order.
    riskRules: z.array(riskRuleSchema),
  })
  .strict()
  .superRefine((policy, context) => {
    const duplicate = <T>(values: readonly T[]): boolean => new Set(values).size !== values.length;

    if (duplicate(policy.allowedOrigins)) {
      context.addIssue({
        code: 'custom',
        message: 'Allowed origins must be unique',
        path: ['allowedOrigins'],
      });
    }

    if (duplicate(policy.allowedActions)) {
      context.addIssue({
        code: 'custom',
        message: 'Allowed actions must be unique',
        path: ['allowedActions'],
      });
    }

    const routeIds = policy.allowedRoutes.map((route) => route.routeId);

    if (duplicate(routeIds)) {
      context.addIssue({
        code: 'custom',
        message: 'Allowed route IDs must be unique',
        path: ['allowedRoutes'],
      });
    }

    const ruleIds = policy.riskRules.map((rule) => rule.ruleId);

    if (duplicate(ruleIds)) {
      context.addIssue({
        code: 'custom',
        message: 'Risk rule IDs must be unique',
        path: ['riskRules'],
      });
    }

    const allowedActions = new Set<PolicyActionKind>(policy.allowedActions);

    const allowedRouteIds = new Set(routeIds);

    for (const [ruleIndex, rule] of policy.riskRules.entries()) {
      for (const action of rule.match.actions) {
        if (!allowedActions.has(action)) {
          context.addIssue({
            code: 'custom',
            message: `Risk rule references action ${action}, ` + 'which is not allowed',
            path: ['riskRules', ruleIndex, 'match', 'actions'],
          });
        }
      }

      for (const routeId of rule.match.routeIds ?? []) {
        if (!allowedRouteIds.has(routeId)) {
          context.addIssue({
            code: 'custom',
            message: `Risk rule references unknown route ` + routeId,
            path: ['riskRules', ruleIndex, 'match', 'routeIds'],
          });
        }
      }
    }
  });

export type AllowedOrigin = z.infer<typeof allowedOriginSchema>;

export type RouteMatch = z.infer<typeof routeMatchSchema>;

export type AllowedRoute = z.infer<typeof allowedRouteSchema>;

export type RiskRule = z.infer<typeof riskRuleSchema>;

export type PolicyConfig = z.infer<typeof policyConfigSchema>;

const policyDecisionBaseSchema = z.object({
  policyId: identifier,
  matchedRuleId: identifier.nullable(),
  reason: description,
});

export const policyDecisionSchema = z
  .discriminatedUnion('decision', [
    policyDecisionBaseSchema
      .extend({
        decision: z.literal('ALLOW'),
        riskLevel: riskLevelSchema,
      })
      .strict(),

    policyDecisionBaseSchema
      .extend({
        decision: z.literal('DENY'),
        code: z.literal('POLICY_DENIED'),

        /*
         * Allowlist validation can deny before
         * risk evaluation takes place.
         */
        riskLevel: riskLevelSchema.nullable(),
      })
      .strict(),

    policyDecisionBaseSchema
      .extend({
        decision: z.literal('REQUIRE_HUMAN'),
        code: z.literal('HUMAN_APPROVAL_REQUIRED'),
        riskLevel: riskLevelSchema,
      })
      .strict(),
  ])
  .superRefine((result, context) => {
    if (
      result.decision === 'ALLOW' &&
      (result.riskLevel === 'SENSITIVE_WRITE' || result.riskLevel === 'IRREVERSIBLE')
    ) {
      context.addIssue({
        code: 'custom',
        message: `${result.riskLevel} decisions ` + 'cannot be automatically allowed',
        path: ['decision'],
      });
    }
  });

export type PolicyDecision = z.infer<typeof policyDecisionSchema>;

export function parsePolicyConfig(value: unknown): PolicyConfig {
  return policyConfigSchema.parse(value);
}

export function parsePolicyDecision(value: unknown): PolicyDecision {
  return policyDecisionSchema.parse(value);
}
