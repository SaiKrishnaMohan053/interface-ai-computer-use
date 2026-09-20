import { describe, expect, it } from 'vitest';

import { PolicyEngine } from '../../src/policy/index.js';

import { evaluateReplayPolicy } from '../../src/replay/index.js';

import type { CapabilityStep } from '../../src/artifact/index.js';

function policy(
  decision: 'ALLOW' | 'DENY' | 'REQUIRE_HUMAN',
  riskLevel: 'READ_ONLY' | 'REVERSIBLE' | 'SENSITIVE_WRITE' | 'IRREVERSIBLE',
): PolicyEngine {
  return new PolicyEngine({
    policyId: 'replay-test-policy',
    version: 1,
    defaultDecision: 'DENY',

    allowedOrigins: ['http://localhost:3000'],

    allowedRoutes: [
      {
        routeId: 'demo',
        description: 'Demo route.',
        match: {
          kind: 'prefix',
          pathname: '/',
        },
      },
    ],

    allowedActions: [
      'click',
      'type',
      'select',
      'check',
      'uncheck',
      'navigate',
      'read',
      'wait',
      'dismiss',
    ],

    riskRules: [
      {
        ruleId: 'test-rule',
        description: 'Replay test rule.',
        match: {
          actions: [
            'click',
            'type',
            'select',
            'check',
            'uncheck',
            'navigate',
            'read',
            'wait',
            'dismiss',
          ],
        },
        riskLevel,
        decision,
      },
    ],
  });
}

function clickStep(risk: CapabilityStep['risk'] = 'READ_ONLY'): CapabilityStep {
  return {
    id: 'click-step',
    description: 'Click.',
    action: {
      kind: 'click',
    },
    risk,
  };
}

function typeStep(risk: CapabilityStep['risk'] = 'REVERSIBLE'): CapabilityStep {
  return {
    id: 'type-step',
    description: 'Type.',
    action: {
      kind: 'type',
      value: {
        kind: 'inputRef',
        name: 'memberName',
      },
      mode: 'replace',
    },
    risk,
  };
}

describe('replay policy enforcement', () => {
  it('allows a replay step only after PolicyEngine ALLOW', () => {
    const result = evaluateReplayPolicy({
      step: clickStep(),
      url: 'http://localhost:3000/member-search',
      policyEngine: policy('ALLOW', 'READ_ONLY'),
    });

    expect(result.status).toBe('allowed');

    if (result.status === 'allowed') {
      expect(result.runtimeRisk).toBe('READ_ONLY');

      expect(result.effectiveRisk).toBe('READ_ONLY');

      expect(result.policyDecision.decision).toBe('ALLOW');
    }
  });

  it('maps policy DENY to POLICY_DENIED', () => {
    const result = evaluateReplayPolicy({
      step: clickStep(),
      url: 'http://localhost:3000/member-search',
      policyEngine: policy('DENY', 'READ_ONLY'),
    });

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('POLICY_DENIED');

      expect(result.error.details.reason).toBe('POLICY_DENIED');
    }
  });

  it('maps REQUIRE_HUMAN to replay intervention', () => {
    const result = evaluateReplayPolicy({
      step: typeStep(),
      url: 'http://localhost:3000/member-search',
      policyEngine: policy('REQUIRE_HUMAN', 'REVERSIBLE'),
    });

    expect(result.status).toBe('intervention_required');

    if (result.status === 'intervention_required') {
      expect(result.intervention.code).toBe('HUMAN_APPROVAL_REQUIRED');
    }
  });

  it('fails closed when runtime risk exceeds artifact step risk', () => {
    const result = evaluateReplayPolicy({
      step: typeStep('READ_ONLY'),
      url: 'http://localhost:3000/member-search',
      policyEngine: policy('ALLOW', 'REVERSIBLE'),
    });

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('POLICY_DENIED');

      expect(result.error.details.reason).toBe('ARTIFACT_RISK_MISMATCH');

      expect(result.error.expected).toBe('READ_ONLY');

      expect(result.error.observed).toBe('REVERSIBLE');
    }
  });

  it('does not downgrade a more conservative persisted risk', () => {
    const result = evaluateReplayPolicy({
      step: clickStep('REVERSIBLE'),
      url: 'http://localhost:3000/member-search',
      policyEngine: policy('ALLOW', 'REVERSIBLE'),
    });

    expect(result.status).toBe('allowed');

    if (result.status === 'allowed') {
      expect(result.runtimeRisk).toBe('READ_ONLY');

      expect(result.effectiveRisk).toBe('REVERSIBLE');
    }
  });

  it('fails when policy under-classifies trusted replay risk', () => {
    const result = evaluateReplayPolicy({
      step: typeStep('REVERSIBLE'),
      url: 'http://localhost:3000/member-search',
      policyEngine: policy('ALLOW', 'READ_ONLY'),
    });

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('POLICY_DENIED');
    }
  });

  it('fails closed for a disallowed runtime location', () => {
    const result = evaluateReplayPolicy({
      step: clickStep(),
      url: 'https://example.com/member-search',
      policyEngine: policy('ALLOW', 'READ_ONLY'),
    });

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('POLICY_DENIED');
    }
  });
});
