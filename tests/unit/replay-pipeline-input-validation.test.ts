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

        description: 'Savings balance.',
      },
    ],

    steps: [
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
          description: 'Savings balance',

          cardinality: 'exactly-one',

          strategies: [
            {
              kind: 'text',

              text: {
                value: 'Savings',

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

        name: 'savingsBalance',
      },
    },

    risk: {
      summaryRisk: 'READ_ONLY',

      maxStepRisk: 'READ_ONLY',

      requiresHumanByDefault: false,

      runtimePolicyRequired: true,
    },

    provenance: {
      discoveryRunId: 'discovery-run-1',

      compiledAt: '2026-09-20T20:00:00.000Z',

      compilerVersion: '1',

      sourceGoal: 'Lookup savings balance.',
    },
  };
}

function dependencies(validateInputs: ReplayPipelineDependencies['validateInputs']) {
  const bindInputs = vi.fn<ReplayPipelineDependencies['bindInputs']>(() => ({}));

  const executeSteps = vi.fn<ReplayPipelineDependencies['executeSteps']>(() =>
    Promise.resolve({
      status: 'success',

      outputs: {},
    }),
  );

  const evaluateSuccessCondition = vi.fn<ReplayPipelineDependencies['evaluateSuccessCondition']>(
    () =>
      Promise.resolve({
        status: 'passed',
      }),
  );

  return {
    dependencies: {
      loadArtifact: () => Promise.resolve(artifact()),

      validateInputs,

      bindInputs,

      executeSteps,

      evaluateSuccessCondition,
    } satisfies ReplayPipelineDependencies,

    bindInputs,
    executeSteps,
    evaluateSuccessCondition,
  };
}

describe('replay pipeline input validation', () => {
  it('rejects missing memberName before any replay execution', async () => {
    const setup = dependencies((_artifact, input) => {
      if (!Object.prototype.hasOwnProperty.call(input, 'memberName')) {
        return {
          status: 'invalid',

          message: 'Required input "memberName" is missing.',

          details: {
            inputName: 'memberName',
          },
        };
      }

      return {
        status: 'valid',

        inputs: {
          memberName: String(input.memberName),
        },
      };
    });

    const result = await executeReplayPipeline(
      {
        capabilityId: 'lookup_savings_balance',

        version: '1.0.0',

        input: {},
      },

      setup.dependencies,
    );

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('INVALID_INPUT');
    }

    expect(setup.bindInputs).not.toHaveBeenCalled();

    expect(setup.executeSteps).not.toHaveBeenCalled();

    expect(setup.evaluateSuccessCondition).not.toHaveBeenCalled();
  });

  it('rejects wrong memberName type before any replay execution', async () => {
    const setup = dependencies((_artifact, input) => {
      if (typeof input.memberName !== 'string') {
        return {
          status: 'invalid',

          message: 'Input "memberName" must be a string.',

          details: {
            inputName: 'memberName',

            expectedType: 'string',
          },
        };
      }

      return {
        status: 'valid',

        inputs: {
          memberName: input.memberName,
        },
      };
    });

    const result = await executeReplayPipeline(
      {
        capabilityId: 'lookup_savings_balance',

        version: '1.0.0',

        input: {
          memberName: 123,
        },
      },

      setup.dependencies,
    );

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('INVALID_INPUT');
    }

    expect(setup.executeSteps).not.toHaveBeenCalled();
  });

  it('rejects unsupported extra input when extra fields are disallowed', async () => {
    const setup = dependencies((_artifact, input) => {
      const allowed = new Set(['memberName']);

      const extra = Object.keys(input).find((key) => !allowed.has(key));

      if (extra !== undefined) {
        return {
          status: 'invalid',

          message: `Unsupported input "${extra}".`,

          details: {
            inputName: extra,
          },
        };
      }

      return {
        status: 'valid',

        inputs: {
          memberName: String(input.memberName),
        },
      };
    });

    const result = await executeReplayPipeline(
      {
        capabilityId: 'lookup_savings_balance',

        version: '1.0.0',

        input: {
          memberName: 'Alex Morgan',

          unsupported: 'value',
        },
      },

      setup.dependencies,
    );

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('INVALID_INPUT');
    }

    expect(setup.executeSteps).not.toHaveBeenCalled();
  });

  it('allows a valid memberName and proceeds to execution', async () => {
    const setup = dependencies((_artifact, input) => {
      if (typeof input.memberName !== 'string') {
        return {
          status: 'invalid',

          message: 'memberName must be string',
        };
      }

      return {
        status: 'valid',

        inputs: {
          memberName: input.memberName,
        },
      };
    });

    await executeReplayPipeline(
      {
        capabilityId: 'lookup_savings_balance',

        version: '1.0.0',

        input: {
          memberName: 'Alex Morgan',
        },
      },

      setup.dependencies,
    );

    expect(setup.bindInputs).toHaveBeenCalledTimes(1);

    expect(setup.executeSteps).toHaveBeenCalledTimes(1);
  });

  it('does not invent enum validation when the artifact declares no enum input', () => {
    const memberInput = artifact().inputs.find((input) => input.name === 'memberName');

    expect(memberInput).toBeDefined();

    expect(memberInput?.type).toBe('string');

    expect('enum' in (memberInput ?? {})).toBe(false);
  });
});
