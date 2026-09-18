import { describe, expect, it } from 'vitest';

import { capabilityRiskMetadataSchema, capabilityStepSchema } from '../../src/artifact/index.js';

describe('artifact risk metadata', () => {
  it('supports separate capability summary and maximum step risk', () => {
    expect(
      capabilityRiskMetadataSchema.parse({
        summaryRisk: 'READ_ONLY',
        maxStepRisk: 'REVERSIBLE',
        requiresHumanByDefault: false,
        runtimePolicyRequired: true,
      }),
    ).toEqual({
      summaryRisk: 'READ_ONLY',
      maxStepRisk: 'REVERSIBLE',
      requiresHumanByDefault: false,
      runtimePolicyRequired: true,
    });
  });

  it('requires runtime policy re-evaluation', () => {
    expect(
      capabilityRiskMetadataSchema.safeParse({
        summaryRisk: 'READ_ONLY',
        maxStepRisk: 'REVERSIBLE',
        requiresHumanByDefault: false,
        runtimePolicyRequired: false,
      }).success,
    ).toBe(false);
  });

  it('reuses the canonical policy risk vocabulary', () => {
    for (const risk of ['READ_ONLY', 'REVERSIBLE', 'SENSITIVE_WRITE', 'IRREVERSIBLE'] as const) {
      expect(
        capabilityRiskMetadataSchema.safeParse({
          summaryRisk: risk,
          maxStepRisk: risk,
          requiresHumanByDefault: false,
          runtimePolicyRequired: true,
        }).success,
      ).toBe(true);
    }
  });

  it('rejects arbitrary stored risk classifications', () => {
    expect(
      capabilityRiskMetadataSchema.safeParse({
        summaryRisk: 'SAFE',
        maxStepRisk: 'REVERSIBLE',
        requiresHumanByDefault: false,
        runtimePolicyRequired: true,
      }).success,
    ).toBe(false);
  });

  it('preserves risk metadata directly on capability steps', () => {
    const step = capabilityStepSchema.parse({
      id: 'enter-member-search',
      description: 'Enter the member name used for search.',
      action: {
        kind: 'type',
        value: {
          kind: 'inputRef',
          name: 'memberName',
        },
        mode: 'replace',
      },
      target: {
        description: 'Member Name input',
        strategies: [
          {
            kind: 'role-name',
            role: 'textbox',
            name: {
              value: 'Member Name',
              mode: 'exact',
              caseSensitive: false,
            },
          },
        ],
        cardinality: 'exactly-one',
      },
      risk: 'REVERSIBLE',
    });

    expect(step.risk).toBe('REVERSIBLE');
  });

  it('does not allow stored metadata to disable runtime policy', () => {
    expect(
      capabilityRiskMetadataSchema.safeParse({
        summaryRisk: 'READ_ONLY',
        maxStepRisk: 'REVERSIBLE',
        requiresHumanByDefault: false,
        runtimePolicyRequired: true,
        skipPolicyEvaluation: true,
      }).success,
    ).toBe(false);
  });
});
