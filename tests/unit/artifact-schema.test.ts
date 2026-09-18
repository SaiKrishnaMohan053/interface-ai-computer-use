import { describe, expect, it } from 'vitest';

import {
  capabilityArtifactSchema,
  parseCapabilityArtifact,
  assertArtifactSafeToPersist,
  ArtifactError,
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
        preconditions: [
          {
            kind: 'elementVisible',
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
          },
        ],
        risk: 'REVERSIBLE',
      },
      {
        id: 'submit-member-search',
        description: 'Submit the member search.',
        action: {
          kind: 'click',
        },
        target: {
          description: 'Search button',
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
        postconditions: [
          {
            kind: 'loadingComplete',
          },
          {
            kind: 'textPresent',
            text: 'Member Details',
            match: 'contains',
            caseSensitive: false,
          },
        ],
        wait: {
          timeoutMs: 5_000,
          pollIntervalMs: 100,
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
          description: 'Accounts navigation',
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
            {
              kind: 'text',
              text: {
                value: 'Accounts',
                mode: 'exact',
                caseSensitive: false,
              },
            },
          ],
          cardinality: 'exactly-one',
        },
        postconditions: [
          {
            kind: 'elementVisible',
            target: {
              description: 'Accounts table',
              strategies: [
                {
                  kind: 'role-name',
                  role: 'table',
                  name: {
                    value: 'Accounts',
                    mode: 'contains',
                    caseSensitive: false,
                  },
                },
              ],
              cardinality: 'exactly-one',
            },
          },
        ],
        wait: {
          timeoutMs: 5_000,
          pollIntervalMs: 100,
        },
        risk: 'READ_ONLY',
      },
      {
        id: 'read-savings-balance',
        description: 'Read the current balance of the Savings account.',
        action: {
          kind: 'read',
          source: 'text',
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
        preconditions: [
          {
            kind: 'elementVisible',
            target: {
              description: 'Accounts table',
              strategies: [
                {
                  kind: 'role-name',
                  role: 'table',
                  name: {
                    value: 'Accounts',
                    mode: 'contains',
                    caseSensitive: false,
                  },
                },
              ],
              cardinality: 'exactly-one',
            },
          },
        ],
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
      kind: 'all',
      conditions: [
        {
          kind: 'surface',
          condition: {
            kind: 'elementVisible',
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
          },
        },
        {
          kind: 'outputPresent',
          output: {
            kind: 'outputRef',
            name: 'savingsBalance',
          },
        },
      ],
    },

    risk: {
      summaryRisk: 'READ_ONLY',
      maxStepRisk: 'REVERSIBLE',
      requiresHumanByDefault: false,
      runtimePolicyRequired: true,
    },

    provenance: {
      discoveryRunId: '9635c0c9-dc3a-4b64-aa38-b1f48a359ea0',
      compiledAt: '2026-09-18T16:00:00.000Z',
      compilerVersion: '1',
      sourceGoal: 'Look up a member and return their current savings balance.',
    },

    metadata: {
      tags: ['balance', 'member-lookup'],
      notes: 'Synthetic assignment capability fixture.',
    },
  };
}

describe('CapabilityArtifact schema', () => {
  it('contains no discovery-specific or runtime-sensitive persisted data', () => {
    const artifact = validArtifact();

    expect(() =>
      assertArtifactSafeToPersist(artifact, {
        forbiddenLiterals: ['Alex Morgan', '$12,840.50'],
      }),
    ).not.toThrow();
  });

  it('fails persistence security scanning for injected sensitive state', () => {
    const artifact = {
      ...validArtifact(),
      metadata: {
        notes: 'Synthetic artifact.',
        sessionId: 'runtime-session-123',
      },
    };

    expect(() => assertArtifactSafeToPersist(artifact)).toThrow(ArtifactError);
  });

  it('persists compact provenance that references the discovery run', () => {
    const artifact = validArtifact();

    expect(artifact.provenance).toEqual({
      discoveryRunId: '9635c0c9-dc3a-4b64-aa38-b1f48a359ea0',
      compiledAt: '2026-09-18T16:00:00.000Z',
      compilerVersion: '1',
      sourceGoal: 'Look up a member and return their current savings balance.',
    });
  });

  it('keeps provenance generalized rather than copying discovery literals', () => {
    const artifact = validArtifact();

    const serialized = JSON.stringify(artifact.provenance);

    expect(serialized).not.toContain('Alex Morgan');
    expect(serialized).not.toContain('$12,840.50');
  });

  it('preserves risk classification at each capability step', () => {
    const artifact = validArtifact();

    expect(
      artifact.steps.map((step) => ({
        id: step.id,
        risk: step.risk,
      })),
    ).toEqual([
      {
        id: 'enter-member-search',
        risk: 'REVERSIBLE',
      },
      {
        id: 'submit-member-search',
        risk: 'REVERSIBLE',
      },
      {
        id: 'open-accounts',
        risk: 'READ_ONLY',
      },
      {
        id: 'read-savings-balance',
        risk: 'READ_ONLY',
      },
    ]);
  });

  it('summarizes the balance capability as read-only while preserving step risk', () => {
    const artifact = validArtifact();

    expect(artifact.risk).toEqual({
      summaryRisk: 'READ_ONLY',
      maxStepRisk: 'REVERSIBLE',
      requiresHumanByDefault: false,
      runtimePolicyRequired: true,
    });
  });

  it('declares only capability-specific known business outcomes', () => {
    const artifact = validArtifact();

    expect(artifact.knownBusinessOutcomes).toEqual([
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
    ]);

    const codes = artifact.knownBusinessOutcomes?.map((outcome) => outcome.code) ?? [];

    expect(codes).toContain('MEMBER_NOT_FOUND');

    expect(codes).not.toContain('PERMISSION_DENIED');
    expect(codes).not.toContain('SESSION_EXPIRED');
    expect(codes).not.toContain('APPLICATION_ERROR');
  });

  it('requires final success to prove Savings context and extracted output', () => {
    const artifact = validArtifact();

    expect(artifact.successCondition).toEqual({
      kind: 'all',
      conditions: [
        {
          kind: 'surface',
          condition: {
            kind: 'elementVisible',
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
          },
        },
        {
          kind: 'outputPresent',
          output: {
            kind: 'outputRef',
            name: 'savingsBalance',
          },
        },
      ],
    });
  });

  it('persists evidence-backed step preconditions and postconditions', () => {
    const artifact = validArtifact();

    const enterSearch = artifact.steps.find((step) => step.id === 'enter-member-search');

    expect(enterSearch?.preconditions).toEqual([
      {
        kind: 'elementVisible',
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
      },
    ]);

    const submitSearch = artifact.steps.find((step) => step.id === 'submit-member-search');

    expect(submitSearch?.postconditions).toEqual([
      {
        kind: 'loadingComplete',
      },
      {
        kind: 'textPresent',
        text: 'Member Details',
        match: 'contains',
        caseSensitive: false,
      },
    ]);

    const openAccounts = artifact.steps.find((step) => step.id === 'open-accounts');

    expect(openAccounts?.postconditions?.[0]?.kind).toBe('elementVisible');
  });
  it('persists semantic targets rather than resolved runtime targets', () => {
    const artifact = validArtifact();

    const openAccountsStep = artifact.steps.find((step) => step.id === 'open-accounts');

    expect(openAccountsStep?.target).toEqual({
      description: 'Accounts navigation',
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
        {
          kind: 'text',
          text: {
            value: 'Accounts',
            mode: 'exact',
            caseSensitive: false,
          },
        },
      ],
      cardinality: 'exactly-one',
    });

    const serialized = JSON.stringify(artifact);

    expect(serialized).not.toContain('resolutionId');
    expect(serialized).not.toContain('observationId');
    expect(serialized).not.toContain('matchedStrategyIndex');
  });

  it('persists the Savings balance as a structural target', () => {
    const artifact = validArtifact();

    const readStep = artifact.steps.find((step) => step.id === 'read-savings-balance');

    expect(readStep?.target?.strategies[0]).toEqual({
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
    });
  });

  it('uses stable ordered step IDs for the reusable capability', () => {
    const artifact = validArtifact();

    expect(artifact.steps.map((step) => step.id)).toEqual([
      'enter-member-search',
      'submit-member-search',
      'open-accounts',
      'read-savings-balance',
    ]);
  });

  it('binds the Savings read step to the declared reusable output', () => {
    const artifact = validArtifact();

    const readStep = artifact.steps.find((step) => step.id === 'read-savings-balance');

    expect(readStep).toBeDefined();

    expect(readStep?.action).toEqual({
      kind: 'read',
      source: 'text',
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
        summaryRisk: 'SOMETHING_ELSE',
        maxStepRisk: 'REVERSIBLE',
        requiresHumanByDefault: false,
        runtimePolicyRequired: true,
      },
    };

    expect(capabilityArtifactSchema.safeParse(artifact).success).toBe(false);
  });

  it('keeps the primary capability compatibility tenant-neutral', () => {
    const artifact = validArtifact();

    expect(artifact.compatibility).toEqual({
      application: 'demo-bank',
      surfaceKind: 'web',
      vendorFamily: 'demo-core',
      supportedVersionRange: '1.x',
    });

    const serialized = JSON.stringify(artifact.compatibility);

    expect(serialized).not.toContain('tenantId');
    expect(serialized).not.toContain('customerId');
    expect(serialized).not.toContain('bankId');
  });

  it('does not persist deployment-specific compatibility state', () => {
    const artifact = {
      ...validArtifact(),
      compatibility: {
        ...validArtifact().compatibility,
        baseUrl: 'https://specific-bank.example.com',
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
