import { describe, expect, it } from 'vitest';

import {
  capabilityArtifactSchema,
  parseCapabilityArtifact,
  type CapabilityArtifact,
} from '../../src/artifact/index.js';

function validArtifact(): CapabilityArtifact {
  return {
    schemaVersion: '1.0',

    identity: {
      id: 'lookup_savings_balance',
      name: 'Lookup Savings Balance',
      version: '1.0.0',
      description: 'Looks up a member and returns the current Savings balance.',
    },

    compatibility: {
      application: 'demo-bank',
      surfaceKind: 'web',
      vendorFamily: 'demo-core',
      supportedVersionRange: '1.x',
    },

    inputs: [
      {
        name: 'memberName',
        type: 'string',
        required: true,
        description: 'Member name supplied for the lookup.',
        sensitive: true,
      },
    ],

    outputs: [
      {
        name: 'savingsBalance',
        type: 'currency',
        required: true,
        description: "Current balance of the member's Savings account.",
      },
    ],

    preconditions: [
      {
        kind: 'textPresent',
        text: 'Member Search',
        match: 'contains',
        caseSensitive: false,
      },
    ],

    steps: [
      {
        id: 'enter-member-name',
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
      },
      {
        id: 'open-accounts',
        description: 'Open the member Accounts view.',
        action: {
          kind: 'click',
        },
        target: {
          description: 'Accounts navigation link',
          strategies: [
            {
              kind: 'role-name',
              role: 'link',
              name: {
                value: 'Accounts',
                mode: 'exact',
                caseSensitive: false,
              },
            },
          ],
          cardinality: 'exactly-one',
        },
        risk: 'READ_ONLY',
      },
      {
        id: 'read-savings-balance',
        description: 'Read the current balance of the Savings account.',
        action: {
          kind: 'read',
          saveAs: {
            kind: 'outputRef',
            name: 'savingsBalance',
          },
        },
        target: {
          description: 'Savings Current Balance cell in Accounts table',
          strategies: [
            {
              kind: 'structural',
              query: {
                kind: 'table-cell',
                table: {
                  name: {
                    value: 'Accounts',
                    mode: 'contains',
                    caseSensitive: false,
                  },
                },
                row: {
                  columnHeader: {
                    value: 'Account Type',
                    mode: 'exact',
                    caseSensitive: false,
                  },
                  value: {
                    value: 'Savings',
                    mode: 'exact',
                    caseSensitive: false,
                  },
                },
                column: {
                  header: {
                    value: 'Current Balance',
                    mode: 'exact',
                    caseSensitive: false,
                  },
                },
              },
            },
          ],
          cardinality: 'exactly-one',
        },
        risk: 'READ_ONLY',
      },
    ],

    knownBusinessOutcomes: [
      {
        code: 'MEMBER_NOT_FOUND',
        description: 'No member matched the supplied lookup input.',
        detector: {
          kind: 'textPresent',
          text: 'Member not found',
          match: 'contains',
          caseSensitive: false,
        },
      },
    ],

    successCondition: {
      kind: 'textPresent',
      text: 'Savings',
      match: 'contains',
      caseSensitive: false,
    },

    risk: {
      maxRisk: 'READ_ONLY',
      requiresHumanByDefault: false,
    },

    provenance: {
      discoveryRunId: 'run-123',
      compiledAt: '2026-09-15T18:17:49.008Z',
      compilerVersion: '1',
    },

    metadata: {
      tags: ['balance', 'member-lookup'],
      notes: 'Synthetic assignment capability fixture.',
    },
  };
}

describe('CapabilityArtifact schema', () => {
  it('binds the Savings read step to the declared reusable output', () => {
    const artifact = validArtifact();

    const readStep = artifact.steps.find((step) => step.id === 'read-savings-balance');

    expect(readStep).toBeDefined();

    expect(readStep?.action).toEqual({
      kind: 'read',
      saveAs: {
        kind: 'outputRef',
        name: 'savingsBalance',
      },
    });

    expect(artifact.outputs).toContainEqual({
      name: 'savingsBalance',
      type: 'currency',
      required: true,
      description: "Current balance of the member's Savings account.",
    });
  });

  it('does not persist the discovery balance as an artifact output value', () => {
    const artifact = validArtifact();

    const serialized = JSON.stringify(artifact);

    expect(serialized).not.toContain('$12,840.50');
  });

  it('persists the member search value as an input reference rather than a discovery literal', () => {
    const artifact = validArtifact();

    const typeStep = artifact.steps.find((step) => step.action.kind === 'type');

    expect(typeStep).toBeDefined();

    expect(typeStep?.action).toEqual({
      kind: 'type',
      value: {
        kind: 'inputRef',
        name: 'memberName',
      },
      mode: 'replace',
    });

    expect(JSON.stringify(artifact)).not.toContain('Alex Morgan');
  });

  it('parses a valid JSON-serializable capability artifact', () => {
    const artifact = validArtifact();

    expect(parseCapabilityArtifact(artifact)).toEqual(artifact);

    expect(() => JSON.stringify(artifact)).not.toThrow();
  });

  it('rejects a missing schema version', () => {
    const artifact = validArtifact();

    const withoutVersion: Record<string, unknown> = {
      ...artifact,
    };

    delete withoutVersion.schemaVersion;

    expect(capabilityArtifactSchema.safeParse(withoutVersion).success).toBe(false);
  });

  it('rejects unsupported arbitrary surface kinds', () => {
    const artifact = {
      ...validArtifact(),
      compatibility: {
        ...validArtifact().compatibility,
        surfaceKind: 'playwright',
      },
    };

    expect(capabilityArtifactSchema.safeParse(artifact).success).toBe(false);
  });

  it('rejects unknown browser/runtime fields on a step', () => {
    const artifact = validArtifact();

    const invalid = {
      ...artifact,
      steps: [
        {
          ...artifact.steps[0],
          resolvedTarget: {
            resolutionId: 'runtime-only',
          },
        },
      ],
    };

    expect(capabilityArtifactSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects Date instances for persisted timestamps', () => {
    const artifact = {
      ...validArtifact(),
      provenance: {
        ...validArtifact().provenance,
        compiledAt: new Date(),
      },
    };

    expect(capabilityArtifactSchema.safeParse(artifact).success).toBe(false);
  });

  it('rejects arbitrary metadata fields that could bypass the contract', () => {
    const artifact = {
      ...validArtifact(),
      metadata: {
        ...validArtifact().metadata,
        rawModelResponse: {
          provider: 'example',
        },
      },
    };

    expect(capabilityArtifactSchema.safeParse(artifact).success).toBe(false);
  });

  it('rejects artifacts without reusable steps', () => {
    const artifact = {
      ...validArtifact(),
      steps: [],
    };

    expect(capabilityArtifactSchema.safeParse(artifact).success).toBe(false);
  });

  it('reuses the existing semantic TargetSpec contract', () => {
    const artifact = validArtifact();

    const accountsStep = artifact.steps.find((step) => step.id === 'open-accounts');

    expect(accountsStep).toBeDefined();

    expect(accountsStep?.target?.strategies[0]).toEqual({
      kind: 'role-name',
      role: 'link',
      name: {
        value: 'Accounts',
        mode: 'exact',
        caseSensitive: false,
      },
    });
  });

  it('reuses the existing policy risk vocabulary', () => {
    const artifact = {
      ...validArtifact(),
      risk: {
        maxRisk: 'SOMETHING_ELSE',
        requiresHumanByDefault: false,
      },
    };

    expect(capabilityArtifactSchema.safeParse(artifact).success).toBe(false);
  });

  it('rejects capability semantic versions in schemaVersion', () => {
    const artifact = {
      ...validArtifact(),
      schemaVersion: '1.0.0',
    };

    expect(capabilityArtifactSchema.safeParse(artifact).success).toBe(false);
  });

  it('rejects schema-style versions as capability versions', () => {
    const artifact = {
      ...validArtifact(),
      identity: {
        ...validArtifact().identity,
        version: '1.0',
      },
    };

    expect(capabilityArtifactSchema.safeParse(artifact).success).toBe(false);
  });

  it('accepts a generalized stable capability identity', () => {
    const artifact = validArtifact();

    expect(artifact.identity).toEqual({
      id: 'lookup_savings_balance',
      name: 'Lookup Savings Balance',
      version: '1.0.0',
      description: 'Looks up a member and returns the current Savings balance.',
    });

    expect(capabilityArtifactSchema.safeParse(artifact).success).toBe(true);
  });

  it('rejects non-snake-case capability IDs', () => {
    const invalidIds = [
      'LookupSavingsBalance',
      'lookup-savings-balance',
      'LOOKUP_SAVINGS_BALANCE',
      'lookup Savings Balance',
    ];

    for (const id of invalidIds) {
      const artifact = {
        ...validArtifact(),
        identity: {
          ...validArtifact().identity,
          id,
        },
      };

      expect(capabilityArtifactSchema.safeParse(artifact).success).toBe(false);
    }
  });

  it('does not use discovery-specific identity for the primary capability', () => {
    const artifact = validArtifact();

    expect(artifact.identity.id).toBe('lookup_savings_balance');
    expect(artifact.identity.id).not.toContain('alex');
    expect(artifact.identity.name).not.toContain('Alex Morgan');
    expect(artifact.identity.description).not.toContain('Alex Morgan');
  });
});
