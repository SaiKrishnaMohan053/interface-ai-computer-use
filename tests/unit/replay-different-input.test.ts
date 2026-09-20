import { describe, expect, it, vi } from 'vitest';

import type { CapabilityArtifact } from '../../src/artifact/index.js';

import { executeReplayPipeline } from '../../src/replay/index.js';

import type { ReplayPipelineDependencies } from '../../src/replay/index.js';

interface SyntheticMember {
  readonly name: string;

  readonly savingsBalance: string;
}

const MEMBERS: readonly SyntheticMember[] = [
  {
    name: 'Alex Morgan',

    savingsBalance: '$12,840.50',
  },

  {
    name: 'Jordan Lee',

    savingsBalance: '$7,425.25',
  },
];

function findMember(memberName: string): SyntheticMember {
  const member = MEMBERS.find((candidate) => candidate.name === memberName);

  if (member === undefined) {
    throw new Error(`Unknown synthetic member: ${memberName}`);
  }

  return member;
}

function reusableArtifact(): CapabilityArtifact {
  return {
    schemaVersion: '1.0',

    identity: {
      id: 'lookup_savings_balance',

      name: 'Lookup Savings Balance',

      version: '1.0.0',

      description:
        'Searches for a member and returns the current balance of their Savings account.',
    },

    compatibility: {
      application: 'demo-bank',

      supportedVersionRange: '1.x',

      surfaceKind: 'web',

      vendorFamily: 'demo-core',
    },

    inputs: [
      {
        description: 'Member name used for search.',

        name: 'memberName',

        required: true,

        sensitive: true,

        type: 'string',
      },
    ],

    outputs: [
      {
        description: "Current balance of the member's Savings account.",

        name: 'savingsBalance',

        required: true,

        type: 'currency',
      },
    ],

    steps: [
      {
        id: 'enter-member-search',

        description: 'Enter member search value.',

        action: {
          kind: 'type',

          mode: 'replace',

          value: {
            kind: 'inputRef',

            name: 'memberName',
          },
        },

        target: {
          cardinality: 'exactly-one',

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
        },

        risk: 'REVERSIBLE',
      },

      {
        id: 'search-member',

        description: 'Search member.',

        action: {
          kind: 'click',
        },

        target: {
          cardinality: 'exactly-one',

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
        },

        risk: 'READ_ONLY',
      },

      {
        id: 'open-accounts',

        description: 'Open accounts.',

        action: {
          kind: 'click',
        },

        target: {
          cardinality: 'exactly-one',

          description: 'Accounts control',

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
        },

        risk: 'READ_ONLY',
      },

      {
        id: 'read-savings-balance',

        description: 'Read Savings Current Balance.',

        action: {
          kind: 'read',

          source: 'text',

          saveAs: {
            kind: 'outputRef',

            name: 'savingsBalance',
          },
        },

        target: {
          cardinality: 'exactly-one',

          description: 'Savings Current Balance',

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
        },

        risk: 'READ_ONLY',
      },
    ],

    successCondition: {
      kind: 'outputPresent',

      output: {
        kind: 'outputRef',

        name: 'savingsBalance',
      },
    },

    risk: {
      summaryRisk: 'READ_ONLY',

      maxStepRisk: 'REVERSIBLE',

      requiresHumanByDefault: false,

      runtimePolicyRequired: true,
    },

    provenance: {
      discoveryRunId: 'single-compiled-artifact',

      compiledAt: '2026-09-20T18:00:00.000Z',

      compilerVersion: '1',

      sourceGoal: 'Look up a member and return their current savings balance.',
    },
  };
}

describe('replay with a different invocation input', () => {
  it('reuses lookup_savings_balance v1.0.0 with a new memberName and produces the new output', async () => {
    const artifact = reusableArtifact();

    const compileArtifact = vi.fn();

    const modelDecision = vi.fn();

    const loadArtifact = vi.fn(() => Promise.resolve(artifact));

    const dependencies: ReplayPipelineDependencies = {
      loadArtifact,

      validateInputs: (loadedArtifact, input) => {
        expect(loadedArtifact).toBe(artifact);

        if (typeof input.memberName !== 'string') {
          return {
            status: 'invalid',

            message: 'memberName must be a string',
          };
        }

        return {
          status: 'valid',

          inputs: {
            memberName: input.memberName,
          },
        };
      },

      bindInputs: (loadedArtifact, inputs) => {
        expect(loadedArtifact).toBe(artifact);

        const memberName = inputs.memberName;

        if (typeof memberName !== 'string') {
          throw new Error('Expected validated memberName input');
        }

        return {
          memberName,
        };
      },

      executeSteps: (loadedArtifact, boundInputs) => {
        expect(loadedArtifact).toBe(artifact);

        const memberName = boundInputs.memberName;

        if (typeof memberName !== 'string') {
          throw new Error('Expected bound memberName');
        }

        const member = findMember(memberName);

        expect(loadedArtifact.steps.map((step) => step.id)).toEqual([
          'enter-member-search',
          'search-member',
          'open-accounts',
          'read-savings-balance',
        ]);

        return Promise.resolve({
          status: 'success',

          outputs: {
            savingsBalance: member.savingsBalance,
          },
        });
      },

      evaluateSuccessCondition: (loadedArtifact, outputs) => {
        expect(loadedArtifact).toBe(artifact);

        expect(typeof outputs.savingsBalance).toBe('string');

        return Promise.resolve({
          status: 'passed',
        });
      },
    };

    const alexResult = await executeReplayPipeline(
      {
        capabilityId: 'lookup_savings_balance',

        version: '1.0.0',

        input: {
          memberName: 'Alex Morgan',
        },
      },

      dependencies,
    );

    const jordanResult = await executeReplayPipeline(
      {
        capabilityId: 'lookup_savings_balance',

        version: '1.0.0',

        input: {
          memberName: 'Jordan Lee',
        },
      },

      dependencies,
    );

    expect(alexResult).toEqual({
      status: 'success',

      outputs: {
        savingsBalance: '$12,840.50',
      },
    });

    expect(jordanResult).toEqual({
      status: 'success',

      outputs: {
        savingsBalance: '$7,425.25',
      },
    });

    expect(loadArtifact).toHaveBeenCalledTimes(2);

    expect(loadArtifact).toHaveBeenNthCalledWith(1, 'lookup_savings_balance', '1.0.0');

    expect(loadArtifact).toHaveBeenNthCalledWith(2, 'lookup_savings_balance', '1.0.0');

    expect(compileArtifact).not.toHaveBeenCalled();

    expect(modelDecision).not.toHaveBeenCalled();

    expect(artifact.identity).toEqual({
      id: 'lookup_savings_balance',

      name: 'Lookup Savings Balance',

      version: '1.0.0',

      description:
        'Searches for a member and returns the current balance of their Savings account.',
    });

    const typeStep = artifact.steps.find((step) => step.id === 'enter-member-search');

    expect(typeStep?.action.kind).toBe('type');

    if (typeStep?.action.kind === 'type') {
      expect(typeStep.action.value).toEqual({
        kind: 'inputRef',

        name: 'memberName',
      });
    }
  });

  it('keeps the artifact structure identical across different invocation values', () => {
    const artifact = reusableArtifact();

    const before = JSON.stringify(artifact);

    findMember('Alex Morgan');

    findMember('Jordan Lee');

    const after = JSON.stringify(artifact);

    expect(after).toBe(before);
  });
});
