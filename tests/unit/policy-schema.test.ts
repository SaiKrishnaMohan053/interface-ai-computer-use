import { describe, expect, it } from 'vitest';
import {
  POLICY_DECISIONS,
  RISK_LEVELS,
  parsePolicyConfig,
  parsePolicyDecision,
  policyConfigSchema,
  riskRuleSchema,
} from '../../src/policy/index.js';

const policy = {
  policyId: 'demo-banking-policy',
  version: 1,
  defaultDecision: 'DENY' as const,

  allowedOrigins: ['http://127.0.0.1:3000'],

  allowedRoutes: [
    {
      routeId: 'member-search',
      description: 'Member search route',
      match: {
        kind: 'exact' as const,
        pathname: '/member-search',
      },
    },
    {
      routeId: 'member-pages',
      description: 'Member servicing routes',
      match: {
        kind: 'prefix' as const,
        pathname: '/member/',
      },
    },
  ],

  allowedActions: ['navigate', 'type', 'click', 'read', 'wait'] as const,

  riskRules: [
    {
      ruleId: 'read-only-observation',
      description: 'Reading and waiting do not change application state',
      match: {
        actions: ['read', 'wait'] as const,
      },
      riskLevel: 'READ_ONLY' as const,
      decision: 'ALLOW' as const,
    },
    {
      ruleId: 'member-search-entry',
      description: 'Member search entry is reversible',
      match: {
        actions: ['navigate', 'type', 'click'] as const,
        routeIds: ['member-search'],
      },
      riskLevel: 'REVERSIBLE' as const,
      decision: 'ALLOW' as const,
    },
  ],
};

describe('policy schema', () => {
  it('accepts allowed origins, routes, actions and ordered risk rules', () => {
    const parsed = parsePolicyConfig(policy);

    expect(parsed).toMatchObject({
      policyId: 'demo-banking-policy',
      defaultDecision: 'DENY',
      allowedOrigins: ['http://127.0.0.1:3000'],
    });

    expect(parsed.riskRules.map((rule) => rule.ruleId)).toEqual([
      'read-only-observation',
      'member-search-entry',
    ]);
  });

  it.each(RISK_LEVELS)('supports risk level %s', (riskLevel) => {
    expect(
      riskRuleSchema.safeParse({
        ruleId: `rule-${riskLevel}`,
        description: `Rule for ${riskLevel}`,
        match: {
          actions: ['click'],
        },
        riskLevel,
        decision:
          riskLevel === 'SENSITIVE_WRITE' || riskLevel === 'IRREVERSIBLE'
            ? 'REQUIRE_HUMAN'
            : 'ALLOW',
      }).success,
    ).toBe(true);
  });

  it.each(POLICY_DECISIONS)('supports policy decision %s', (decision) => {
    const result = parsePolicyDecision({
      policyId: 'demo-banking-policy',
      decision,
      riskLevel: decision === 'ALLOW' ? 'READ_ONLY' : 'SENSITIVE_WRITE',
      matchedRuleId: decision === 'DENY' ? null : 'rule-1',
      reason: `Policy decided ${decision}`,
      ...(decision === 'DENY'
        ? {
            code: 'POLICY_DENIED',
          }
        : {}),
      ...(decision === 'REQUIRE_HUMAN'
        ? {
            code: 'HUMAN_APPROVAL_REQUIRED',
          }
        : {}),
    });

    expect(result.decision).toBe(decision);
  });

  it('rejects origins containing paths, credentials or unsupported protocols', () => {
    for (const origin of [
      'http://127.0.0.1:3000/member-search',
      'https://user:secret@example.com',
      'file:///member-search',
    ]) {
      expect(
        policyConfigSchema.safeParse({
          ...policy,
          allowedOrigins: [origin],
        }).success,
      ).toBe(false);
    }
  });

  it('rejects duplicate allowlist entries and identifiers', () => {
    expect(
      policyConfigSchema.safeParse({
        ...policy,
        allowedActions: ['read', 'read'],
      }).success,
    ).toBe(false);

    expect(
      policyConfigSchema.safeParse({
        ...policy,
        allowedRoutes: [policy.allowedRoutes[0], policy.allowedRoutes[0]],
      }).success,
    ).toBe(false);
  });

  it('rejects risk rules that reference actions or routes outside the allowlist', () => {
    expect(
      policyConfigSchema.safeParse({
        ...policy,
        riskRules: [
          {
            ruleId: 'outside-policy',
            description: 'Invalid external reference',
            match: {
              actions: ['select'],
              routeIds: ['admin-page'],
            },
            riskLevel: 'REVERSIBLE',
            decision: 'ALLOW',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('prevents sensitive and irreversible rules from silently allowing actions', () => {
    for (const riskLevel of ['SENSITIVE_WRITE', 'IRREVERSIBLE'] as const) {
      expect(
        riskRuleSchema.safeParse({
          ruleId: 'unsafe-rule',
          description: 'Unsafe automatic action',
          match: {
            actions: ['click'],
          },
          riskLevel,
          decision: 'ALLOW',
        }).success,
      ).toBe(false);
    }

    expect(
      parsePolicyDecision.bind(null, {
        policyId: 'demo-banking-policy',
        decision: 'ALLOW',
        riskLevel: 'SENSITIVE_WRITE',
        matchedRuleId: 'unsafe-rule',
        reason: 'Unsafe automatic approval',
      }),
    ).toThrow();
  });

  it('requires secure default denial and rejects unknown configuration fields', () => {
    expect(
      policyConfigSchema.safeParse({
        ...policy,
        defaultDecision: 'ALLOW',
      }).success,
    ).toBe(false);

    expect(
      policyConfigSchema.safeParse({
        ...policy,
        trustAgentRiskClaim: true,
      }).success,
    ).toBe(false);
  });
});
