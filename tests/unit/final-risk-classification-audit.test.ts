import { describe, expect, it } from 'vitest';

import { classifyDiscoveryDecisionRisk } from '../../src/discovery/index.js';

import { PolicyEngine } from '../../src/policy/index.js';

import {
  classifyReplayStepRisk,
  evaluateReplayPolicy,
  maxReplayRisk,
} from '../../src/replay/index.js';

import type { CapabilityStep } from '../../src/artifact/index.js';

function discoveryDecision(value: unknown): Parameters<typeof classifyDiscoveryDecisionRisk>[0] {
  return value as Parameters<typeof classifyDiscoveryDecisionRisk>[0];
}

function replayStep(
  action: CapabilityStep['action'],
  risk: CapabilityStep['risk'],
): CapabilityStep {
  return {
    id: 'audit-step',
    description: 'Final risk audit step.',
    action,
    risk,
  };
}

function demoPolicy(): PolicyEngine {
  return new PolicyEngine({
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
}

describe('final risk classification audit', () => {
  it('classifies read balance as READ_ONLY', () => {
    expect(
      classifyDiscoveryDecisionRisk(
        discoveryDecision({
          kind: 'read',
          target: {
            description: 'Savings Current Balance',
            strategies: [
              {
                kind: 'text',
                text: 'Current Balance',
              },
            ],
            cardinality: 'exactly-one',
          },
          saveAs: 'savingsBalance',
        }),
      ).riskLevel,
    ).toBe('READ_ONLY');
  });

  it('classifies navigation and search semantics as READ_ONLY', () => {
    expect(
      classifyDiscoveryDecisionRisk(
        discoveryDecision({
          kind: 'navigate',
          destination: 'http://localhost:3000/member-search',
        }),
      ).riskLevel,
    ).toBe('READ_ONLY');

    expect(
      classifyDiscoveryDecisionRisk(
        discoveryDecision({
          kind: 'click',
          target: {
            description: 'Search',
            strategies: [
              {
                kind: 'role-name',
                role: 'button',
                name: {
                  value: 'Search',
                  mode: 'exact',
                  caseSensitive: false,
                },
              },
            ],
            cardinality: 'exactly-one',
          },
        }),
      ).riskLevel,
    ).toBe('READ_ONLY');
  });

  it('classifies ordinary unsubmitted form fill as REVERSIBLE', () => {
    expect(
      classifyDiscoveryDecisionRisk(
        discoveryDecision({
          kind: 'type',
          target: {
            description: 'Sub-account nickname',
            strategies: [
              {
                kind: 'label',
                label: {
                  value: 'Nickname',
                  mode: 'exact',
                  caseSensitive: false,
                },
              },
            ],
            cardinality: 'exactly-one',
          },
          value: 'Vacation',
          mode: 'replace',
        }),
      ).riskLevel,
    ).toBe('REVERSIBLE');
  });

  it('classifies sensitive field mutation as SENSITIVE_WRITE', () => {
    expect(
      classifyDiscoveryDecisionRisk(
        discoveryDecision({
          kind: 'type',
          target: {
            description: 'Account number',
            strategies: [
              {
                kind: 'label',
                label: {
                  value: 'Account Number',
                  mode: 'exact',
                  caseSensitive: false,
                },
              },
            ],
            cardinality: 'exactly-one',
          },
          value: 'synthetic-account-number',
          mode: 'replace',
        }),
      ).riskLevel,
    ).toBe('SENSITIVE_WRITE');
  });

  it('classifies final create/submit semantics as IRREVERSIBLE', () => {
    expect(
      classifyDiscoveryDecisionRisk(
        discoveryDecision({
          kind: 'click',
          target: {
            description: 'Confirm Create Sub-Account',
            strategies: [
              {
                kind: 'role-name',
                role: 'button',
                name: {
                  value: 'Confirm Create Sub-Account',
                  mode: 'exact',
                  caseSensitive: false,
                },
              },
            ],
            cardinality: 'exactly-one',
          },
        }),
      ).riskLevel,
    ).toBe('IRREVERSIBLE');
  });

  it('keeps replay runtime classification as a minimum and never downgrades persisted irreversible risk', () => {
    const step = replayStep(
      {
        kind: 'click',
      },
      'IRREVERSIBLE',
    );

    const runtimeRisk = classifyReplayStepRisk(step);

    expect(runtimeRisk).toBe('READ_ONLY');

    expect(maxReplayRisk(runtimeRisk, step.risk)).toBe('IRREVERSIBLE');
  });

  it('does not allow the selected demo policy to automatically execute the final irreversible commit', () => {
    const step = replayStep(
      {
        kind: 'click',
      },
      'IRREVERSIBLE',
    );

    const result = evaluateReplayPolicy({
      step: {
        ...step,
        id: 'confirm-create',
        description: 'Confirm Create Sub-Account',
      },

      url: 'http://localhost:3000/member/12345/subaccounts/commit',

      policyEngine: demoPolicy(),
    });

    expect(result).toMatchObject({
      status: 'intervention_required',

      intervention: {
        code: 'HUMAN_APPROVAL_REQUIRED',

        details: {
          stepId: 'confirm-create',
          actionKind: 'click',
          storedRisk: 'IRREVERSIBLE',
          effectiveRisk: 'IRREVERSIBLE',
          matchedRuleId: 'irreversible-subaccount-commit',
        },
      },
    });

    expect(result.status).not.toBe('allowed');
  });

  it('fails closed when a policy rule attempts to under-classify trusted irreversible risk', () => {
    const permissiveLookingPolicy = new PolicyEngine({
      policyId: 'underclassification-audit',
      version: 1,
      defaultDecision: 'DENY',

      allowedOrigins: ['http://localhost:3000'],

      allowedRoutes: [
        {
          routeId: 'commit',
          description: 'Commit route',
          match: {
            kind: 'exact',
            pathname: '/member/12345/subaccounts/commit',
          },
        },
      ],

      allowedActions: ['click'],

      riskRules: [
        {
          ruleId: 'incorrect-read-only-click',
          description: 'Intentionally under-classified audit rule',
          match: {
            actions: ['click'],
            routeIds: ['commit'],
          },
          riskLevel: 'READ_ONLY',
          decision: 'ALLOW',
        },
      ],
    });

    expect(
      permissiveLookingPolicy.evaluate({
        url: 'http://localhost:3000/member/12345/subaccounts/commit',

        action: {
          kind: 'click',
        },

        systemRiskLevel: 'IRREVERSIBLE',
      }),
    ).toMatchObject({
      decision: 'DENY',
      code: 'POLICY_DENIED',
      riskLevel: 'IRREVERSIBLE',
      matchedRuleId: 'incorrect-read-only-click',
    });
  });
});
