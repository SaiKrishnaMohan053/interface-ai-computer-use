import { describe, expect, it, vi } from 'vitest';

import type { CapabilityArtifact } from '../../src/artifact/index.js';

import { continueReplayAfterManualStep, ReplayOutputStore } from '../../src/replay/index.js';

import type { ReplayStepExecutor } from '../../src/replay/index.js';

const artifact: CapabilityArtifact = {
  schemaVersion: '1.0',

  identity: {
    id: 'prepare_new_savings_subaccount',
    name: 'Prepare New Savings Sub-Account',
    version: '1.0.0',
    description: 'Prepare and confirm a new savings sub-account.',
  },

  compatibility: {
    application: 'demo-bank',
    surfaceKind: 'web',
    supportedVersionRange: '1.x',
    vendorFamily: 'demo-core',
  },

  inputs: [],

  outputs: [],

  preconditions: [],

  steps: [
    {
      id: 'prepare-form',
      description: 'Prepare sub-account form.',
      action: {
        kind: 'click',
      },
      risk: 'REVERSIBLE',
    },

    {
      id: 'confirm-create',
      description: 'Confirm Create Sub-Account.',
      action: {
        kind: 'click',
      },
      risk: 'IRREVERSIBLE',
    },

    {
      id: 'verify-created',
      description: 'Verify the created sub-account.',
      action: {
        kind: 'wait',
        condition: {
          kind: 'textPresent',
          text: 'Sub-account created',
          match: 'contains',
          caseSensitive: false,
        },
      },
      risk: 'READ_ONLY',
    },
  ],

  knownBusinessOutcomes: [],

  successCondition: {
    kind: 'all',
    conditions: [
      {
        kind: 'surface',
        condition: {
          kind: 'textPresent',
          text: 'Sub-account created',
          match: 'contains',
          caseSensitive: false,
        },
      },
    ],
  },

  risk: {
    summaryRisk: 'IRREVERSIBLE',
    maxStepRisk: 'IRREVERSIBLE',
    requiresHumanByDefault: true,
    runtimePolicyRequired: true,
  },

  provenance: {
    discoveryRunId: 'discovery-run-1',
    compiledAt: '2026-09-22T17:40:00.000Z',
    compilerVersion: '1',
    sourceGoal: 'Prepare a new savings sub-account and reach confirmation.',
  },

  metadata: {},
};

describe('replay continuation after manual step', () => {
  it('continues at the next artifact step without re-executing the human-completed irreversible step', async () => {
    const execute = vi.fn<ReplayStepExecutor['execute']>(() =>
      Promise.resolve({
        status: 'success',
      }),
    );

    const outputStore = new ReplayOutputStore(artifact);

    const result = await continueReplayAfterManualStep({
      artifact,

      inputs: {},

      outputStore,

      stepExecutor: {
        execute,
      },

      resume: {
        status: 'manual_step_resolved',

        stepId: 'confirm-create',

        resumedFromStepIndex: 1,

        continueAtStepIndex: 2,

        freshObservationId: 'observation-after-human',
      },
    });

    expect(result).toEqual({
      status: 'success',

      stepsExecuted: 3,

      outputs: {},
    });

    expect(execute).toHaveBeenCalledTimes(1);

    expect(execute.mock.calls[0]?.[0].id).toBe('verify-created');

    expect(execute.mock.calls.some(([executedStep]) => executedStep.id === 'confirm-create')).toBe(
      false,
    );
  });

  it('preserves run-scoped outputs produced before the human handoff', async () => {
    const artifactWithOutput: CapabilityArtifact = {
      ...artifact,

      outputs: [
        {
          name: 'preparationId',
          type: 'string',
          required: true,
          description: 'Identifier produced before the human handoff.',
        },
      ],

      successCondition: {
        kind: 'all',
        conditions: [
          {
            kind: 'surface',
            condition: {
              kind: 'textPresent',
              text: 'Sub-account created',
              match: 'contains',
              caseSensitive: false,
            },
          },
          {
            kind: 'outputPresent',
            output: {
              kind: 'outputRef',
              name: 'preparationId',
            },
          },
        ],
      },
    };

    const outputStore = new ReplayOutputStore(artifactWithOutput);

    expect(
      outputStore.store(
        {
          kind: 'outputRef',
          name: 'preparationId',
        },
        'prep-123',
      ),
    ).toEqual({
      status: 'stored',
    });

    const result = await continueReplayAfterManualStep({
      artifact: artifactWithOutput,

      inputs: {},

      outputStore,

      stepExecutor: {
        execute: () =>
          Promise.resolve({
            status: 'success',
          }),
      },

      resume: {
        status: 'manual_step_resolved',

        stepId: 'confirm-create',

        resumedFromStepIndex: 1,

        continueAtStepIndex: 2,

        freshObservationId: 'observation-after-human',
      },
    });

    expect(result).toEqual({
      status: 'success',

      stepsExecuted: 3,

      outputs: {
        preparationId: 'prep-123',
      },
    });
  });

  it('fails closed if the continuation index does not immediately follow the resolved step', async () => {
    const execute = vi.fn();

    const result = await continueReplayAfterManualStep({
      artifact,

      inputs: {},

      outputStore: new ReplayOutputStore(artifact),

      stepExecutor: {
        execute: execute as ReplayStepExecutor['execute'],
      },

      resume: {
        status: 'manual_step_resolved',

        stepId: 'confirm-create',

        resumedFromStepIndex: 1,

        continueAtStepIndex: 1,

        freshObservationId: 'observation-after-human',
      },
    });

    expect(result).toMatchObject({
      status: 'failure',

      stepId: 'confirm-create',

      error: {
        code: 'ACTION_FAILED',
      },
    });

    expect(execute).not.toHaveBeenCalled();
  });

  it('fails closed if the resolved step identity does not match the artifact', async () => {
    const execute = vi.fn();

    const result = await continueReplayAfterManualStep({
      artifact,

      inputs: {},

      outputStore: new ReplayOutputStore(artifact),

      stepExecutor: {
        execute: execute as ReplayStepExecutor['execute'],
      },

      resume: {
        status: 'manual_step_resolved',

        stepId: 'wrong-step',

        resumedFromStepIndex: 1,

        continueAtStepIndex: 2,

        freshObservationId: 'observation-after-human',
      },
    });

    expect(result).toMatchObject({
      status: 'failure',

      error: {
        code: 'ACTION_FAILED',
      },
    });

    expect(execute).not.toHaveBeenCalled();
  });
});
