import { describe, expect, it } from 'vitest';

import {
  ArtifactCompiler,
  parseCapabilityArtifact,
  serializeCapabilityArtifact,
  validateCapabilityArtifactSemantics,
} from '../../src/artifact/index.js';

import { createCompileOptions } from '../helpers/artifact-compiler-fixture.js';

import {
  FROZEN_ENTRY_URL,
  FROZEN_INPUT,
  FROZEN_OUTPUT,
  FROZEN_RUN_ID,
  loadFrozenSource,
} from '../helpers/frozen-discovery-source.js';

describe('frozen Phase 2 discovery artifact integration', () => {
  it('compiles the genuine Alex Morgan discovery run into lookup_savings_balance v1.0.0', async () => {
    const source = await loadFrozenSource();

    expect(source.runId).toBe(FROZEN_RUN_ID);

    expect(source.request.goal).toBe(
      'Look up Alex Morgan and return their current savings balance.',
    );

    expect(source.result.status).toBe('success');

    if (source.result.status !== 'success') {
      throw new Error('Expected frozen discovery success');
    }

    expect(source.result.outputs.alexMorganSavingsBalance).toBe(FROZEN_OUTPUT);

    const compiler = new ArtifactCompiler();

    const artifact = compiler.compile(source, createCompileOptions());

    const parsed = parseCapabilityArtifact(artifact);

    validateCapabilityArtifactSemantics(parsed);

    expect(parsed.identity.id).toBe('lookup_savings_balance');

    expect(parsed.identity.version).toBe('1.0.0');

    expect(parsed.provenance.discoveryRunId).toBe(FROZEN_RUN_ID);

    expect(parsed.steps.map((step) => step.id)).toEqual([
      'enter-member-search',
      'submit-member-search',
      'open-accounts',
      'read-savings-balance',
    ]);
  });

  it('parameterizes the frozen member value and output binding', async () => {
    const source = await loadFrozenSource();

    const artifact = new ArtifactCompiler().compile(source, createCompileOptions());

    expect(artifact.inputs.map((input) => input.name)).toEqual(['memberName']);

    expect(artifact.outputs.map((output) => output.name)).toEqual(['savingsBalance']);

    expect(artifact.steps[0]?.action).toEqual({
      kind: 'type',

      value: {
        kind: 'inputRef',

        name: 'memberName',
      },

      mode: 'replace',
    });

    expect(artifact.steps[3]?.action).toEqual({
      kind: 'read',

      source: 'text',

      saveAs: {
        kind: 'outputRef',

        name: 'savingsBalance',
      },
    });
  });

  it('retains the structural Savings Current Balance locator from the genuine run', async () => {
    const source = await loadFrozenSource();

    const artifact = new ArtifactCompiler().compile(source, createCompileOptions());

    const readStep = artifact.steps.find((step) => step.id === 'read-savings-balance');

    expect(readStep).toBeDefined();

    expect(readStep?.target).toMatchObject({
      strategies: [
        {
          kind: 'structural',

          query: {
            kind: 'table-cell',

            table: {
              name: {
                value: 'Accounts',
              },
            },

            row: {
              columnHeader: {
                value: 'Account Type',
              },

              value: {
                value: 'Savings',
              },
            },

            column: {
              header: {
                value: 'Current Balance',
              },
            },
          },
        },
      ],
    });
  });

  it('does not persist invocation values runtime URLs or runtime IDs from the frozen run', async () => {
    const source = await loadFrozenSource();

    const artifact = new ArtifactCompiler().compile(source, createCompileOptions());

    const serialized = serializeCapabilityArtifact(artifact);

    expect(serialized).not.toContain(FROZEN_INPUT);

    expect(serialized).not.toContain(FROZEN_OUTPUT);

    expect(serialized).not.toContain(FROZEN_ENTRY_URL);

    expect(serialized).not.toContain('49349');

    expect(serialized).not.toContain('c2fcaa85-4097-4d61-a14e-f1c65a1ba77a');

    expect(serialized).not.toContain('99cccfcd-5d5e-4784-ad32-4e6049bd804a');
  });

  it('compiles only the four reusable successful actions and excludes runtime navigation and completion', async () => {
    const source = await loadFrozenSource();

    const artifact = new ArtifactCompiler().compile(source, createCompileOptions());

    expect(artifact.steps).toHaveLength(4);

    expect(artifact.steps.map((step) => step.action.kind)).toEqual([
      'type',
      'click',
      'click',
      'read',
    ]);

    expect(artifact.steps.some((step) => step.action.kind === 'navigate')).toBe(false);

    const serialized = serializeCapabilityArtifact(artifact);

    expect(serialized).not.toContain('"kind": "complete"');
  });

  it('verifies the complete reusable content of the real compiled artifact', async () => {
    const source = await loadFrozenSource();

    const artifact = new ArtifactCompiler().compile(source, createCompileOptions());

    expect(artifact.identity).toMatchObject({
      id: 'lookup_savings_balance',
      name: 'Lookup Savings Balance',
      version: '1.0.0',
    });

    expect(artifact.inputs).toEqual([
      {
        name: 'memberName',
        type: 'string',
        required: true,
        description: 'Member name used for search.',
        sensitive: true,
      },
    ]);

    expect(artifact.outputs).toEqual([
      {
        name: 'savingsBalance',
        type: 'currency',
        required: true,
        description: "Current balance of the member's Savings account.",
      },
    ]);

    expect(artifact.steps.map((step) => step.id)).toEqual([
      'enter-member-search',
      'submit-member-search',
      'open-accounts',
      'read-savings-balance',
    ]);

    const [enterMemberSearch, submitMemberSearch, openAccounts, readSavingsBalance] =
      artifact.steps;

    expect(enterMemberSearch).toMatchObject({
      id: 'enter-member-search',

      action: {
        kind: 'type',

        value: {
          kind: 'inputRef',

          name: 'memberName',
        },

        mode: 'replace',
      },

      target: {
        description: 'textbox named "Member Name"',

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
        },
      ],

      risk: 'REVERSIBLE',
    });

    expect(submitMemberSearch).toMatchObject({
      id: 'submit-member-search',

      action: {
        kind: 'click',
      },

      target: {
        description: 'button named "Search"',

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

      risk: 'READ_ONLY',
    });

    expect(openAccounts).toMatchObject({
      id: 'open-accounts',

      action: {
        kind: 'click',
      },

      target: {
        description: 'link named "Accounts"',

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

      postconditions: [
        {
          kind: 'elementVisible',
        },
      ],

      wait: {
        timeoutMs: 5_000,

        pollIntervalMs: 100,
      },

      risk: 'READ_ONLY',
    });

    expect(readSavingsBalance).toMatchObject({
      id: 'read-savings-balance',

      action: {
        kind: 'read',

        source: 'text',

        saveAs: {
          kind: 'outputRef',

          name: 'savingsBalance',
        },
      },

      target: {
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
        },
      ],

      risk: 'READ_ONLY',
    });

    expect(artifact.preconditions).toEqual([
      {
        kind: 'textPresent',

        text: 'Member Search',

        match: 'contains',

        caseSensitive: false,
      },
    ]);

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

    expect(artifact.compatibility).toEqual({
      application: 'demo-bank',

      vendorFamily: 'demo-core',

      surfaceKind: 'web',

      supportedVersionRange: '1.x',
    });

    expect(artifact.risk).toEqual({
      summaryRisk: 'READ_ONLY',

      maxStepRisk: 'REVERSIBLE',

      requiresHumanByDefault: false,

      runtimePolicyRequired: true,
    });

    expect(artifact.provenance).toEqual({
      discoveryRunId: FROZEN_RUN_ID,

      compiledAt: '2026-09-18T16:00:00.000Z',

      compilerVersion: '1',

      sourceGoal: 'Look up a member and return their current savings balance.',
    });

    expect(artifact.successCondition).toMatchObject({
      kind: 'all',

      conditions: [
        {
          kind: 'surface',
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

  it('verifies the final serialized artifact contains no discovery or runtime leakage', async () => {
    const source = await loadFrozenSource();

    const artifact = new ArtifactCompiler().compile(source, createCompileOptions());

    const serialized = serializeCapabilityArtifact(artifact);

    const lower = serialized.toLowerCase();

    const forbiddenExact = [
      'Alex Morgan',
      '$12,840.50',
      'http://127.0.0.1:49349',
      '49349',

      'c2fcaa85-4097-4d61-a14e-f1c65a1ba77a',
      '080ad0d3-e322-471f-949d-f07419eab892',
      '6da1927a-6a9c-4c40-95a6-11604eae9a6e',
      'bd65fc95-c655-487a-b848-69a4ea55dbca',
      'e01e65b2-7871-456e-9a97-fda397e348de',

      '99cccfcd-5d5e-4784-ad32-4e6049bd804a',
      '1c3fe5ea-cd33-405a-aab3-f967cd939931',

      'aab92c93-9e92-41b6-adb1-0d8546bff925',
    ];

    for (const forbidden of forbiddenExact) {
      expect(serialized).not.toContain(forbidden);
    }

    const forbiddenRuntimeOrProviderTerms = [
      'browsercontext',
      'elementhandle',
      'rawmodelresponse',
      'chainofthought',
      'modelrationale',
      'decision rationale',
      'api key',
      'apikey',
      'openai_api_key',
      'screenshot-0001',
      'screenshot-0002',
      'screenshot-0003',
      'screenshot-0004',
      'screenshot-0005',
      'image/png',
      'application/x-ndjson',
    ];

    for (const forbidden of forbiddenRuntimeOrProviderTerms) {
      expect(lower).not.toContain(forbidden.toLowerCase());
    }

    expect(artifact.provenance).not.toHaveProperty('trace');

    expect(artifact.provenance).not.toHaveProperty('observations');

    expect(artifact.provenance).not.toHaveProperty('decisions');

    expect(artifact.provenance).not.toHaveProperty('reasoning');

    expect(artifact.provenance).not.toHaveProperty('rawModelResponse');

    expect(artifact.provenance).not.toHaveProperty('modelRationale');

    expect(artifact).not.toHaveProperty('screenshots');

    expect(artifact).not.toHaveProperty('trace');

    expect(artifact).not.toHaveProperty('failedRetries');

    expect(artifact).not.toHaveProperty('completionDecision');

    expect(artifact.steps.some((step) => step.action.kind === 'navigate')).toBe(false);

    expect(serialized).not.toContain('"kind": "complete"');
  });
});
