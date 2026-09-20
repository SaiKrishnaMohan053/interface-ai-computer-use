import { describe, expect, it, vi } from 'vitest';

import { executeReplayPipeline } from '../../src/replay/index.js';

import type { CapabilityArtifact } from '../../src/artifact/index.js';

import type { ReplayPipelineDependencies } from '../../src/replay/index.js';

function artifact(): CapabilityArtifact {
  return {
    schemaVersion: '1.0',

    identity: {
      id: 'lookup_savings_balance',

      name: 'Lookup savings balance',

      version: '1.0.0',

      description: 'Lookup savings balance.',
    },

    compatibility: {
      application: 'interface-ai-demo-bank',

      surfaceKind: 'web',
    },

    inputs: [
      {
        name: 'memberName',

        type: 'string',

        required: true,

        sensitive: true,

        description: 'Member name.',
      },
    ],

    outputs: [
      {
        name: 'savingsBalance',

        type: 'currency',

        required: true,

        description: 'Savings account balance.',
      },
    ],

    steps: [
      {
        id: 'enter-member-name',

        description: 'Enter member name.',

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

          cardinality: 'exactly-one',

          strategies: [
            {
              kind: 'label',

              label: {
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
          description: 'Search button',

          cardinality: 'exactly-one',

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
          description: 'Accounts control',

          cardinality: 'exactly-one',

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

        description: 'Read savings balance.',

        action: {
          kind: 'read',

          source: 'text',

          saveAs: {
            kind: 'outputRef',

            name: 'savingsBalance',
          },
        },

        target: {
          description: 'Savings Current Balance',

          cardinality: 'exactly-one',

          strategies: [
            {
              kind: 'text',

              text: {
                value: '$12,840.50',

                mode: 'exact',

                caseSensitive: true,
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
      discoveryRunId: 'discovery-run-1',

      compiledAt: '2026-09-20T20:00:00.000Z',

      compilerVersion: '1',

      sourceGoal: 'Find the member savings balance.',
    },
  };
}

describe('successful replay pipeline', () => {
  it('loads artifact, binds memberName, executes ordered steps, extracts savingsBalance, verifies success, and returns success', async () => {
    const calls: string[] = [];

    const loadArtifact = vi.fn<ReplayPipelineDependencies['loadArtifact']>(
      (capabilityId, version) => {
        calls.push('load-artifact');

        expect(capabilityId).toBe('lookup_savings_balance');

        expect(version).toBe('1.0.0');

        return Promise.resolve(artifact());
      },
    );

    const validateInputs = vi.fn<ReplayPipelineDependencies['validateInputs']>(
      (_artifact, input) => {
        calls.push('validate-inputs');

        expect(input).toEqual({
          memberName: 'Alex Morgan',
        });

        return {
          status: 'valid',

          inputs: {
            memberName: 'Alex Morgan',
          },
        };
      },
    );

    const bindInputs = vi.fn<ReplayPipelineDependencies['bindInputs']>((_artifact, inputs) => {
      calls.push('bind-inputs');

      expect(inputs.memberName).toBe('Alex Morgan');

      return {
        memberName: 'Alex Morgan',
      };
    });

    const executeSteps = vi.fn<ReplayPipelineDependencies['executeSteps']>(
      (loadedArtifact, boundInputs) => {
        calls.push('execute-steps');

        expect(boundInputs.memberName).toBe('Alex Morgan');

        expect(loadedArtifact.steps.map((step) => step.id)).toEqual([
          'enter-member-name',
          'search-member',
          'open-accounts',
          'read-savings-balance',
        ]);

        return Promise.resolve({
          status: 'success',

          outputs: {
            savingsBalance: '$12,840.50',
          },
        });
      },
    );

    const evaluateSuccessCondition = vi.fn<ReplayPipelineDependencies['evaluateSuccessCondition']>(
      (loadedArtifact, outputs) => {
        calls.push('success-condition');

        expect(loadedArtifact.successCondition.kind).toBe('outputPresent');

        expect(outputs.savingsBalance).toBe('$12,840.50');

        return Promise.resolve({
          status: 'passed',
        });
      },
    );

    const result = await executeReplayPipeline(
      {
        capabilityId: 'lookup_savings_balance',

        version: '1.0.0',

        input: {
          memberName: 'Alex Morgan',
        },
      },

      {
        loadArtifact,
        validateInputs,
        bindInputs,
        executeSteps,
        evaluateSuccessCondition,
      },
    );

    expect(calls).toEqual([
      'load-artifact',
      'validate-inputs',
      'bind-inputs',
      'execute-steps',
      'success-condition',
    ]);

    expect(result).toEqual({
      status: 'success',

      outputs: {
        savingsBalance: '$12,840.50',
      },
    });
  });

  it('does not return success when final success condition fails', async () => {
    const result = await executeReplayPipeline(
      {
        capabilityId: 'lookup_savings_balance',

        version: '1.0.0',

        input: {
          memberName: 'Alex Morgan',
        },
      },

      {
        loadArtifact: () => Promise.resolve(artifact()),

        validateInputs: () => ({
          status: 'valid',

          inputs: {
            memberName: 'Alex Morgan',
          },
        }),

        bindInputs: () => ({
          memberName: 'Alex Morgan',
        }),

        executeSteps: () =>
          Promise.resolve({
            status: 'success',

            outputs: {
              savingsBalance: '$12,840.50',
            },
          }),

        evaluateSuccessCondition: () =>
          Promise.resolve({
            status: 'failed',

            message: 'Final success condition was not satisfied.',
          }),
      },
    );

    expect(result).toEqual({
      status: 'failure',

      error: {
        code: 'CHECKPOINT_FAILED',

        message: 'Final success condition was not satisfied.',
      },
    });
  });

  it('stops when ordered step execution fails', async () => {
    const successCondition = vi.fn();

    const result = await executeReplayPipeline(
      {
        capabilityId: 'lookup_savings_balance',

        version: '1.0.0',

        input: {
          memberName: 'Alex Morgan',
        },
      },

      {
        loadArtifact: () => Promise.resolve(artifact()),

        validateInputs: () => ({
          status: 'valid',

          inputs: {
            memberName: 'Alex Morgan',
          },
        }),

        bindInputs: () => ({
          memberName: 'Alex Morgan',
        }),

        executeSteps: () =>
          Promise.resolve({
            status: 'failure',

            message: 'Step execution failed.',
          }),

        evaluateSuccessCondition: successCondition,
      },
    );

    expect(result).toEqual({
      status: 'failure',

      error: {
        code: 'ACTION_FAILED',

        message: 'Step execution failed.',
      },
    });

    expect(successCondition).not.toHaveBeenCalled();
  });
});
