import { describe, expect, it } from 'vitest';

import type { CapabilityArtifact } from '../../src/artifact/index.js';

import { executeReplayPipeline } from '../../src/replay/index.js';

import type { ReplayPipelineDependencies } from '../../src/replay/index.js';

interface DeterministicTrace {
  readonly stepSequence: readonly string[];

  readonly targetResolutionSequence: readonly string[];

  readonly output: Readonly<Record<string, string>>;

  readonly terminalStatus: 'success';
}

function targetSequence(artifact: CapabilityArtifact): readonly string[] {
  return artifact.steps.flatMap((step) =>
    step.target === undefined
      ? []
      : step.target.strategies.map((strategy, index) => `${step.id}:${index}:${strategy.kind}`),
  );
}

function createDependencies(
  artifact: CapabilityArtifact,
  trace: DeterministicTrace,
): ReplayPipelineDependencies {
  return {
    loadArtifact: () => Promise.resolve(artifact),

    validateInputs: (_artifact, input) => {
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

    bindInputs: (_artifact, inputs) => {
      const memberName = inputs.memberName;

      if (typeof memberName !== 'string') {
        throw new Error('Expected validated memberName input');
      }

      return {
        memberName,
      };
    },

    executeSteps: (loadedArtifact) => {
      const stepSequence = loadedArtifact.steps.map((step) => step.id);

      const resolutionSequence = targetSequence(loadedArtifact);

      expect(stepSequence).toEqual(trace.stepSequence);

      expect(resolutionSequence).toEqual(trace.targetResolutionSequence);

      return Promise.resolve({
        status: 'success',

        outputs: trace.output,
      });
    },

    evaluateSuccessCondition: (_artifact, outputs) => {
      expect(outputs).toEqual(trace.output);

      return Promise.resolve({
        status: 'passed',
      });
    },
  };
}

describe('deterministic replay execution', () => {
  it('produces equivalent deterministic behavior for the same artifact, inputs, and scenario', async () => {
    const artifact: CapabilityArtifact = {
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

          description: 'Search for member.',

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

          description: 'Read savings current balance.',

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
        discoveryRunId: 'determinism-source',

        compiledAt: '2026-09-20T18:00:00.000Z',

        compilerVersion: '1',

        sourceGoal: 'Look up a member and return their current savings balance.',
      },
    };

    const expected: DeterministicTrace = {
      stepSequence: [
        'enter-member-search',
        'search-member',
        'open-accounts',
        'read-savings-balance',
      ],

      targetResolutionSequence: [
        'enter-member-search:0:role-name',
        'search-member:0:role-name',
        'open-accounts:0:role-name',
        'read-savings-balance:0:structural',
      ],

      output: {
        savingsBalance: '$12,840.50',
      },

      terminalStatus: 'success',
    };

    const first = await executeReplayPipeline(
      {
        capabilityId: 'lookup_savings_balance',

        version: '1.0.0',

        input: {
          memberName: 'Alex Morgan',
        },
      },

      createDependencies(artifact, expected),
    );

    const second = await executeReplayPipeline(
      {
        capabilityId: 'lookup_savings_balance',

        version: '1.0.0',

        input: {
          memberName: 'Alex Morgan',
        },
      },

      createDependencies(artifact, expected),
    );

    expect(first).toEqual(second);

    expect(first).toEqual({
      status: 'success',

      outputs: {
        savingsBalance: '$12,840.50',
      },
    });
  });

  it('ignores nondeterministic run metadata when comparing deterministic behavior', () => {
    const first = {
      runId: 'run-1',

      sessionId: 'session-1',

      startedAt: '2026-09-20T18:00:00.000Z',

      finishedAt: '2026-09-20T18:00:01.000Z',

      stepSequence: ['step-a', 'step-b'],

      output: {
        savingsBalance: '$12,840.50',
      },

      status: 'success',
    };

    const second = {
      runId: 'run-2',

      sessionId: 'session-2',

      startedAt: '2026-09-20T18:05:00.000Z',

      finishedAt: '2026-09-20T18:05:01.000Z',

      stepSequence: ['step-a', 'step-b'],

      output: {
        savingsBalance: '$12,840.50',
      },

      status: 'success',
    };

    const normalize = (value: typeof first) => ({
      stepSequence: value.stepSequence,

      output: value.output,

      status: value.status,
    });

    expect(normalize(first)).toEqual(normalize(second));
  });
});
