import { describe, expect, it } from 'vitest';

import { PolicyEngine } from '../../src/policy/index.js';

const engine = new PolicyEngine({
  policyId: 'demo-banking-policy',
  version: 1,
  defaultDecision: 'DENY',

  allowedOrigins: ['http://127.0.0.1:3000', 'http://localhost:3000'],

  allowedRoutes: [
    {
      routeId: 'member-search',
      description: 'Member search route',
      match: {
        kind: 'exact',
        pathname: '/member-search',
      },
    },
    {
      routeId: 'subaccount-commit',
      description: 'Sub-account commit route',
      match: {
        kind: 'exact',
        pathname: '/member/12345/subaccounts/commit',
      },
    },
    {
      routeId: 'member-pages',
      description: 'Member servicing routes',
      match: {
        kind: 'prefix',
        pathname: '/member/',
      },
    },
  ],

  allowedActions: ['navigate', 'type', 'click', 'read', 'wait', 'dismiss'],

  riskRules: [
    {
      /*
       * This rule must appear before the broad
       * reversible member-pages rule.
       */
      ruleId: 'irreversible-subaccount-commit',
      description: 'Committing a sub-account requires human approval',
      match: {
        actions: ['click'],
        routeIds: ['subaccount-commit'],
      },
      riskLevel: 'IRREVERSIBLE',
      decision: 'REQUIRE_HUMAN',
    },
    {
      ruleId: 'read-only-actions',
      description: 'Read-only actions may run automatically',
      match: {
        actions: ['read', 'wait'],
      },
      riskLevel: 'READ_ONLY',
      decision: 'ALLOW',
    },
    {
      ruleId: 'reversible-member-actions',
      description: 'Reversible member navigation and input are allowed',
      match: {
        actions: ['navigate', 'type', 'click'],
        routeIds: ['member-search', 'member-pages'],
      },
      riskLevel: 'REVERSIBLE',
      decision: 'ALLOW',
    },
  ],
});

describe('PolicyEngine', () => {
  it('allows an allowlisted localhost origin, route and action', () => {
    expect(
      engine.evaluate({
        url: 'http://localhost:3000/member-search',
        action: {
          kind: 'navigate',
        },
      }),
    ).toMatchObject({
      decision: 'ALLOW',
      riskLevel: 'REVERSIBLE',
      matchedRuleId: 'reversible-member-actions',
    });
  });

  it('denies an external origin before evaluating its route or risk', () => {
    expect(
      engine.evaluate({
        url: 'https://attacker.example/member-search',
        action: {
          kind: 'read',
        },
      }),
    ).toMatchObject({
      decision: 'DENY',
      code: 'POLICY_DENIED',
      riskLevel: null,
      matchedRuleId: null,
      reason: 'Request origin is not allowed',
    });
  });

  it('allows a read action on an allowlisted member route', () => {
    expect(
      engine.evaluate({
        url: 'http://127.0.0.1:3000/member/12345/accounts',
        action: {
          kind: 'read',
        },
      }),
    ).toMatchObject({
      decision: 'ALLOW',
      riskLevel: 'READ_ONLY',
      matchedRuleId: 'read-only-actions',
    });
  });

  it('denies an unknown action', () => {
    expect(
      engine.evaluate({
        url: 'http://127.0.0.1:3000/member-search',
        action: {
          kind: 'execute-script',
        },
      }),
    ).toMatchObject({
      decision: 'DENY',
      code: 'POLICY_DENIED',
      riskLevel: null,
      reason: 'Request action is not allowed',
    });
  });

  it('requires a human for an irreversible commit', () => {
    expect(
      engine.evaluate({
        url: 'http://127.0.0.1:3000/member/12345/subaccounts/commit',
        action: {
          kind: 'click',
        },
      }),
    ).toMatchObject({
      decision: 'REQUIRE_HUMAN',
      code: 'HUMAN_APPROVAL_REQUIRED',
      riskLevel: 'IRREVERSIBLE',
      matchedRuleId: 'irreversible-subaccount-commit',
    });
  });

  it('denies an unallowlisted route', () => {
    expect(
      engine.evaluate({
        url: 'http://127.0.0.1:3000/admin',
        action: {
          kind: 'read',
        },
      }),
    ).toMatchObject({
      decision: 'DENY',
      code: 'POLICY_DENIED',
      reason: 'Request route is not allowed',
    });
  });

  it('uses the first matching ordered risk rule', () => {
    expect(
      engine.evaluate({
        url: 'http://127.0.0.1:3000/member/12345/subaccounts/commit',
        action: {
          kind: 'click',
        },
      }).matchedRuleId,
    ).toBe('irreversible-subaccount-commit');
  });

  it('fails closed for malformed URLs and missing risk rules', () => {
    expect(
      engine.evaluate({
        url: 'not a URL',
        action: {
          kind: 'read',
        },
      }).decision,
    ).toBe('DENY');

    /*
     * dismiss is allowlisted but has no matching
     * risk rule, so default DENY applies.
     */
    expect(
      engine.evaluate({
        url: 'http://127.0.0.1:3000/member-search',
        action: {
          kind: 'dismiss',
        },
      }).decision,
    ).toBe('DENY');
  });
});
