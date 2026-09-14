import { describe, expect, it } from 'vitest';

import { PolicyEngine } from '../../src/policy/index.js';
import type { PolicyActionKind, PolicyDecisionKind } from '../../src/policy/index.js';
import { evaluateDiscoveryActionPolicy, parseAgentObservation } from '../../src/discovery/index.js';
import type {
  ActionableDiscoveryDecision,
  AgentObservation,
  AgentTargetSpec,
} from '../../src/discovery/index.js';

const actions: PolicyActionKind[] = [
  'click',
  'type',
  'select',
  'check',
  'uncheck',
  'navigate',
  'read',
  'wait',
  'dismiss',
];

const target: AgentTargetSpec = {
  description: 'Visible control',
  strategies: [
    {
      kind: 'role-name',
      role: 'button',
      name: {
        value: 'Accounts',
        mode: 'exact',
        caseSensitive: false,
      },
    },
  ],
  cardinality: 'exactly-one',
};

function observation(
  location: AgentObservation['location'] = {
    kind: 'web',
    url: 'https://bank.test/member/alex',
    title: 'Alex Morgan',
  },
): AgentObservation {
  return parseAgentObservation({
    goal: "Read Alex Morgan's Savings balance",
    step: 2,
    observationId: 'observation-2',
    capturedAt: '2026-09-11T17:00:00.000Z',
    location,
    visibleTextSummary: 'Alex Morgan Accounts',
    controls: [],
    dialogs: [],
    contextHints: { frames: [], regions: [] },
    loading: 'complete',
    truncated: { visibleText: false, controls: false },
    extractedValues: {},
    recentAction: null,
    recentCondition: null,
    recentError: null,
  });
}

function policy(decision: PolicyDecisionKind = 'ALLOW'): PolicyEngine {
  return new PolicyEngine({
    policyId: 'discovery-policy',
    version: 1,
    defaultDecision: 'DENY',
    allowedOrigins: ['https://bank.test'],
    allowedRoutes: [
      {
        routeId: 'bank',
        description: 'Approved fake bank routes',
        match: { kind: 'prefix', pathname: '/' },
      },
    ],
    allowedActions: actions,
    riskRules: actions.map((action) => ({
      ruleId: `${action}-rule`,
      description: `${action} is classified by trusted policy`,
      match: { actions: [action], routeIds: ['bank'] },
      riskLevel: ['read', 'navigate', 'wait'].includes(action) ? 'READ_ONLY' : 'REVERSIBLE',
      decision,
    })),
  });
}

const decisions: ActionableDiscoveryDecision[] = [
  { kind: 'click', target, reason: 'Click visible control' },
  { kind: 'type', target, text: 'Alex Morgan', mode: 'replace', reason: 'Enter member' },
  {
    kind: 'select',
    target,
    option: { kind: 'label', label: 'Savings' },
    reason: 'Select account',
  },
  { kind: 'check', target, reason: 'Check visible control' },
  { kind: 'uncheck', target, reason: 'Uncheck visible control' },
  {
    kind: 'navigate',
    destination: 'https://bank.test/member-search',
    reason: 'Navigate to approved route',
  },
  { kind: 'read', target, source: 'text', saveAs: 'balance', reason: 'Read balance' },
  {
    kind: 'wait',
    condition: { kind: 'loadingComplete' },
    reason: 'Wait for defined completion signal',
  },
  {
    kind: 'dismiss',
    dialog: { kind: 'surface', target },
    reason: 'Dismiss known interstitial',
  },
];

describe('Discovery policy gate', () => {
  it.each(decisions)('evaluates validated $kind decisions through PolicyEngine', (decision) => {
    const result = evaluateDiscoveryActionPolicy({
      policyEngine: policy(),
      observation: observation(),
      decision,
    });

    expect(result.actionKind).toBe(decision.kind);
    const expectedSystemRisk = ['click', 'read', 'navigate', 'wait'].includes(decision.kind)
      ? 'READ_ONLY'
      : 'REVERSIBLE';

    const expectedPolicyRisk = ['read', 'navigate', 'wait'].includes(decision.kind)
      ? 'READ_ONLY'
      : 'REVERSIBLE';

    expect(result.risk).toMatchObject({
      source: 'system',
      riskLevel: expectedSystemRisk,
    });
    expect(result.decision).toMatchObject({
      decision: 'ALLOW',
      riskLevel: expectedPolicyRisk,
      matchedRuleId: `${decision.kind}-rule`,
    });
  });

  it('evaluates navigation against its destination instead of the current page', () => {
    const result = evaluateDiscoveryActionPolicy({
      policyEngine: policy(),
      observation: observation(),
      decision: {
        kind: 'navigate',
        destination: 'https://untrusted.test/member-search',
        reason: 'Model requested an untrusted destination',
      },
    });

    expect(result.policyUrl).toBe('https://untrusted.test/member-search');
    expect(result.decision).toMatchObject({
      decision: 'DENY',
      code: 'POLICY_DENIED',
    });
  });

  it('preserves a deterministic REQUIRE_HUMAN result', () => {
    const result = evaluateDiscoveryActionPolicy({
      policyEngine: policy('REQUIRE_HUMAN'),
      observation: observation(),
      decision: {
        kind: 'click',
        target,
        reason: 'The model says this action is needed',
      },
    });

    expect(result.decision).toMatchObject({
      decision: 'REQUIRE_HUMAN',
      code: 'HUMAN_APPROVAL_REQUIRED',
      riskLevel: 'REVERSIBLE',
    });
  });

  it('preserves a deterministic DENY result', () => {
    const result = evaluateDiscoveryActionPolicy({
      policyEngine: policy('DENY'),
      observation: observation(),
      decision: {
        kind: 'read',
        target,
        source: 'text',
        saveAs: 'balance',
        reason: 'The model says the read is required',
      },
    });

    expect(result.decision).toMatchObject({
      decision: 'DENY',
      code: 'POLICY_DENIED',
    });
  });

  it('fails closed for a non-web observation', () => {
    const result = evaluateDiscoveryActionPolicy({
      policyEngine: policy(),
      observation: observation({
        kind: 'application',
        applicationId: 'desktop-bank',
        windowTitle: 'Accounts',
      }),
      decision: {
        kind: 'click',
        target,
        reason: 'Click the visible control',
      },
    });

    expect(result.policyUrl).toBe('');
    expect(result.decision).toMatchObject({
      decision: 'DENY',
      code: 'POLICY_DENIED',
    });
  });

  it('denies when configured policy under-classifies system-derived risk', () => {
    const result = evaluateDiscoveryActionPolicy({
      policyEngine: policy(),
      observation: observation(),
      decision: {
        kind: 'click',
        target: {
          description: 'Submit application',
          strategies: [
            {
              kind: 'role-name',
              role: 'button',
              name: {
                value: 'Submit application',
                mode: 'exact',
                caseSensitive: false,
              },
            },
          ],
          cardinality: 'exactly-one',
        },
        reason: 'The model claims this is safe',
      },
    });

    expect(result.risk).toMatchObject({
      source: 'system',
      riskLevel: 'IRREVERSIBLE',
    });
    expect(result.decision).toMatchObject({
      decision: 'DENY',
      code: 'POLICY_DENIED',
      riskLevel: 'IRREVERSIBLE',
      matchedRuleId: 'click-rule',
    });
  });
});
