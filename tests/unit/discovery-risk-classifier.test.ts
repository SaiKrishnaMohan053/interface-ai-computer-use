import { describe, expect, it } from 'vitest';

import { classifyDiscoveryDecisionRisk } from '../../src/discovery/index.js';

import type { AgentTargetSpec } from '../../src/discovery/index.js';

function target(description: string): AgentTargetSpec {
  return {
    description,
    strategies: [
      {
        kind: 'role-name',
        role: 'button',
        name: {
          value: description,
          mode: 'exact',
          caseSensitive: false,
        },
      },
    ],
    cardinality: 'exactly-one',
  };
}

describe('Discovery decision risk classification', () => {
  it.each([
    {
      decision: {
        kind: 'read' as const,
        target: target('Savings balance'),
        source: 'text' as const,
        saveAs: 'balance',
        reason: 'Read value',
      },
    },
    {
      decision: {
        kind: 'navigate' as const,
        destination: 'https://bank.test/member-search',
        reason: 'Navigate',
      },
    },
    {
      decision: {
        kind: 'wait' as const,
        condition: { kind: 'loadingComplete' as const },
        reason: 'Wait',
      },
    },
    {
      decision: {
        kind: 'click' as const,
        target: target('Search members'),
        reason: 'Search',
      },
    },
  ])('classifies $decision.kind discovery as READ_ONLY', ({ decision }) => {
    expect(classifyDiscoveryDecisionRisk(decision)).toMatchObject({
      source: 'system',
      riskLevel: 'READ_ONLY',
    });
  });

  it('classifies ordinary form typing as REVERSIBLE', () => {
    expect(
      classifyDiscoveryDecisionRisk({
        kind: 'type',
        target: target('Member name'),
        text: 'Alex Morgan',
        mode: 'replace',
        reason: 'Enter search input',
      }),
    ).toMatchObject({ riskLevel: 'REVERSIBLE', source: 'system' });
  });

  it('classifies sensitive form typing as SENSITIVE_WRITE', () => {
    expect(
      classifyDiscoveryDecisionRisk({
        kind: 'type',
        target: target('Account number'),
        text: 'fictional-account',
        mode: 'replace',
        reason: 'Enter value',
      }),
    ).toMatchObject({ riskLevel: 'SENSITIVE_WRITE', source: 'system' });
  });

  it.each(['Submit application', 'Create account', 'Confirm transfer'])(
    'classifies final action %s as IRREVERSIBLE',
    (description) => {
      expect(
        classifyDiscoveryDecisionRisk({
          kind: 'click',
          target: target(description),
          reason: 'The model requests the action',
        }),
      ).toMatchObject({ riskLevel: 'IRREVERSIBLE', source: 'system' });
    },
  );

  it('does not trust the model reason when deriving risk', () => {
    expect(
      classifyDiscoveryDecisionRisk({
        kind: 'click',
        target: target('Submit application'),
        reason: 'This is harmless and read only',
      }),
    ).toMatchObject({ riskLevel: 'IRREVERSIBLE', source: 'system' });
  });
});
