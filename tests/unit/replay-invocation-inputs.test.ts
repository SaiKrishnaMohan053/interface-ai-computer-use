import { describe, expect, it } from 'vitest';

import { validateReplayInvocationInputs } from '../../src/replay/index.js';

import type { CapabilityArtifact, CapabilityInput } from '../../src/artifact/index.js';

function artifactWithInputs(inputs: readonly CapabilityInput[]): CapabilityArtifact {
  return {
    schemaVersion: '1.0',

    identity: {
      id: 'test_capability',
      name: 'Test Capability',
      version: '1.0.0',
      description: 'Replay input validation fixture.',
    },

    compatibility: {
      application: 'demo-bank',
      surfaceKind: 'web',
    },

    inputs: [...inputs],

    outputs: [
      {
        name: 'result',
        type: 'string',
        required: true,
        description: 'Fixture output.',
      },
    ],

    steps: [
      {
        id: 'read-result',
        description: 'Read fixture result.',
        action: {
          kind: 'read',
          source: 'text',
          saveAs: {
            kind: 'outputRef',
            name: 'result',
          },
        },
        target: {
          description: 'Fixture result',
          cardinality: 'exactly-one',
          strategies: [
            {
              kind: 'text',
              text: {
                value: 'Result',
                mode: 'exact',
                caseSensitive: false,
              },
            },
          ],
        },
        risk: 'READ_ONLY',
      },
    ],

    successCondition: {
      kind: 'outputPresent',
      output: {
        kind: 'outputRef',
        name: 'result',
      },
    },

    risk: {
      summaryRisk: 'READ_ONLY',
      maxStepRisk: 'READ_ONLY',
      requiresHumanByDefault: false,
      runtimePolicyRequired: true,
    },

    provenance: {
      discoveryRunId: 'fixture-run',
      compiledAt: '2026-09-20T12:00:00.000-05:00',
      compilerVersion: '1',
      sourceGoal: 'Validate replay invocation inputs.',
    },

    metadata: {},
  };
}

describe('replay invocation input validation', () => {
  it('accepts the declared required string input', () => {
    const artifact = artifactWithInputs([
      {
        name: 'memberName',
        type: 'string',
        required: true,
        description: 'Member name.',
        sensitive: true,
      },
    ]);

    const result = validateReplayInvocationInputs(artifact, {
      memberName: 'Alex Morgan',
    });

    expect(result).toEqual({
      status: 'valid',
      inputs: {
        memberName: 'Alex Morgan',
      },
    });
  });

  it('rejects a missing required input', () => {
    const artifact = artifactWithInputs([
      {
        name: 'memberName',
        type: 'string',
        required: true,
        description: 'Member name.',
        sensitive: true,
      },
    ]);

    const result = validateReplayInvocationInputs(artifact, {});

    expect(result.status).toBe('invalid');

    if (result.status === 'invalid') {
      expect(result.error.code).toBe('INVALID_INPUT');
      expect(result.error.details.reason).toBe('REQUIRED_INPUT_MISSING');
    }
  });

  it('rejects unexpected inputs', () => {
    const artifact = artifactWithInputs([]);

    const result = validateReplayInvocationInputs(artifact, {
      memberName: 'Alex Morgan',
    });

    expect(result.status).toBe('invalid');

    if (result.status === 'invalid') {
      expect(result.error.code).toBe('INVALID_INPUT');
      expect(result.error.details.reason).toBe('UNEXPECTED_INPUT');
    }
  });

  it('rejects a wrong primitive type without leaking a sensitive value', () => {
    const artifact = artifactWithInputs([
      {
        name: 'memberName',
        type: 'string',
        required: true,
        description: 'Member name.',
        sensitive: true,
      },
    ]);

    const result = validateReplayInvocationInputs(artifact, {
      memberName: 123,
    });

    expect(result.status).toBe('invalid');

    if (result.status === 'invalid') {
      expect(result.error.details.reason).toBe('TYPE_MISMATCH');
      expect(result.error.details.sensitive).toBe(true);
      expect(result.error.observed).toBe('number');
      expect(result.error.expected).toBe('string');
    }
  });

  it('accepts finite number input', () => {
    const artifact = artifactWithInputs([
      {
        name: 'count',
        type: 'number',
        required: true,
        description: 'Count.',
        sensitive: false,
      },
    ]);

    const result = validateReplayInvocationInputs(artifact, {
      count: 42,
    });

    expect(result.status).toBe('valid');
  });

  it('rejects a non-finite number', () => {
    const artifact = artifactWithInputs([
      {
        name: 'count',
        type: 'number',
        required: true,
        description: 'Count.',
        sensitive: false,
      },
    ]);

    const result = validateReplayInvocationInputs(artifact, {
      count: Number.NaN,
    });

    expect(result.status).toBe('invalid');
  });

  it('accepts boolean input', () => {
    const artifact = artifactWithInputs([
      {
        name: 'enabled',
        type: 'boolean',
        required: true,
        description: 'Enabled state.',
        sensitive: false,
      },
    ]);

    const result = validateReplayInvocationInputs(artifact, {
      enabled: true,
    });

    expect(result.status).toBe('valid');
  });

  it('accepts non-empty string currency input', () => {
    const artifact = artifactWithInputs([
      {
        name: 'amount',
        type: 'currency',
        required: true,
        description: 'Amount.',
        sensitive: false,
      },
    ]);

    const result = validateReplayInvocationInputs(artifact, {
      amount: '$12.50',
    });

    expect(result.status).toBe('valid');
  });

  it('accepts finite numeric currency input', () => {
    const artifact = artifactWithInputs([
      {
        name: 'amount',
        type: 'currency',
        required: true,
        description: 'Amount.',
        sensitive: false,
      },
    ]);

    const result = validateReplayInvocationInputs(artifact, {
      amount: 12.5,
    });

    expect(result.status).toBe('valid');
  });

  it('fails closed for enum inputs because current artifact schema has no enum domain', () => {
    const artifact = artifactWithInputs([
      {
        name: 'accountType',
        type: 'enum',
        required: true,
        description: 'Account type.',
        sensitive: false,
      },
    ]);

    const result = validateReplayInvocationInputs(artifact, {
      accountType: 'Savings',
    });

    expect(result.status).toBe('invalid');

    if (result.status === 'invalid') {
      expect(result.error.code).toBe('INVALID_INPUT');
      expect(result.error.details.reason).toBe('ENUM_DOMAIN_UNDECLARED');
    }
  });

  it('allows omitted optional inputs', () => {
    const artifact = artifactWithInputs([
      {
        name: 'memberName',
        type: 'string',
        required: false,
        description: 'Optional member name.',
        sensitive: true,
      },
    ]);

    const result = validateReplayInvocationInputs(artifact, {});

    expect(result).toEqual({
      status: 'valid',
      inputs: {},
    });
  });
});
