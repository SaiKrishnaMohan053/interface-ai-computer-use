import { describe, expect, it, vi } from 'vitest';

import { ReplayEngine } from '../../src/replay/index.js';

import type {
  ArtifactStore,
  CapabilityArtifact,
  CapabilityStep,
} from '../../src/artifact/index.js';

import type { ReplayOrderedStepResult, ReplayStepExecutor } from '../../src/replay/index.js';

const steps: CapabilityStep[] = [
  {
    id: 'step-one',
    description: 'First step.',
    action: {
      kind: 'click',
    },
    target: {
      description: 'First control',
      cardinality: 'exactly-one',
      strategies: [
        {
          kind: 'text',
          text: {
            value: 'One',
            mode: 'exact',
            caseSensitive: false,
          },
        },
      ],
    },
    risk: 'READ_ONLY',
  },

  {
    id: 'step-two',
    description: 'Second step.',
    action: {
      kind: 'click',
    },
    target: {
      description: 'Second control',
      cardinality: 'exactly-one',
      strategies: [
        {
          kind: 'text',
          text: {
            value: 'Two',
            mode: 'exact',
            caseSensitive: false,
          },
        },
      ],
    },
    risk: 'READ_ONLY',
  },

  {
    id: 'step-three',
    description: 'Third step.',
    action: {
      kind: 'read',
      source: 'text',
      saveAs: {
        kind: 'outputRef',
        name: 'result',
      },
    },
    target: {
      description: 'Result',
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
];

const artifact: CapabilityArtifact = {
  schemaVersion: '1.0',

  identity: {
    id: 'ordered_test',
    name: 'Ordered Test',
    version: '1.0.0',
    description: 'Tests strict replay ordering.',
  },

  compatibility: {
    application: 'demo-bank',
    surfaceKind: 'web',
  },

  inputs: [],

  outputs: [
    {
      name: 'result',
      type: 'string',
      required: true,
      description: 'Result.',
    },
  ],

  steps,

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
    discoveryRunId: 'test-run',
    compiledAt: '2026-09-20T12:00:00.000-05:00',
    compilerVersion: '1',
    sourceGoal: 'Strict ordering test.',
  },

  metadata: {},
};

function artifactStore() {
  return {
    load: vi.fn(() => Promise.resolve(artifact)),
  } satisfies Pick<ArtifactStore, 'load'>;
}

describe('ReplayEngine strict ordered execution', () => {
  it('executes artifact steps exactly in stored order', async () => {
    const executed: string[] = [];

    const execute = vi.fn<ReplayStepExecutor['execute']>((step, _stepIndex, context) => {
      executed.push(step.id);

      if (step.action.kind === 'read') {
        context.outputStore.store(step.action.saveAs, 'done');
      }

      return Promise.resolve({
        status: 'success',
      } satisfies ReplayOrderedStepResult);
    });

    const executor: ReplayStepExecutor = {
      execute,
    };

    const engine = new ReplayEngine({
      artifactStore: artifactStore(),
      stepExecutor: executor,
    });

    const result = await engine.runOrderedSteps({
      capabilityId: 'ordered_test',
      version: '1.0.0',
      inputs: {},
    });

    expect(executed).toEqual(['step-one', 'step-two', 'step-three']);

    expect(result).toEqual({
      status: 'success',
      stepsExecuted: 3,
      outputs: {
        result: 'done',
      },
    });
  });

  it('passes the exact zero-based artifact index to execution', async () => {
    const indexes: number[] = [];

    const execute = vi.fn<ReplayStepExecutor['execute']>((step, stepIndex, context) => {
      indexes.push(stepIndex);

      if (step.action.kind === 'read') {
        context.outputStore.store(step.action.saveAs, 'done');
      }

      return Promise.resolve({
        status: 'success',
      } satisfies ReplayOrderedStepResult);
    });

    const executor: ReplayStepExecutor = {
      execute,
    };

    const engine = new ReplayEngine({
      artifactStore: artifactStore(),
      stepExecutor: executor,
    });

    await engine.runOrderedSteps({
      capabilityId: 'ordered_test',
      version: '1.0.0',
      inputs: {},
    });

    expect(indexes).toEqual([0, 1, 2]);
  });

  it('stops immediately when a step fails', async () => {
    const executed: string[] = [];

    const execute = vi.fn<ReplayStepExecutor['execute']>((step) => {
      executed.push(step.id);

      if (step.id === 'step-two') {
        return Promise.resolve({
          status: 'failure',
          code: 'ACTION_FAILED',
          message: 'Step failed.',
        } satisfies ReplayOrderedStepResult);
      }

      return Promise.resolve({
        status: 'success',
      } satisfies ReplayOrderedStepResult);
    });

    const executor: ReplayStepExecutor = {
      execute,
    };

    const engine = new ReplayEngine({
      artifactStore: artifactStore(),
      stepExecutor: executor,
    });

    const result = await engine.runOrderedSteps({
      capabilityId: 'ordered_test',
      version: '1.0.0',
      inputs: {},
    });

    expect(executed).toEqual(['step-one', 'step-two']);

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.stepId).toBe('step-two');
      expect(result.stepsExecuted).toBe(1);
    }
  });

  it('stops immediately on a business outcome', async () => {
    const executed: string[] = [];

    const execute = vi.fn<ReplayStepExecutor['execute']>((step) => {
      executed.push(step.id);

      if (step.id === 'step-two') {
        return Promise.resolve({
          status: 'business_outcome',
          code: 'MEMBER_NOT_FOUND',
        } satisfies ReplayOrderedStepResult);
      }

      return Promise.resolve({
        status: 'success',
      } satisfies ReplayOrderedStepResult);
    });

    const executor: ReplayStepExecutor = {
      execute,
    };

    const engine = new ReplayEngine({
      artifactStore: artifactStore(),
      stepExecutor: executor,
    });

    const result = await engine.runOrderedSteps({
      capabilityId: 'ordered_test',
      version: '1.0.0',
      inputs: {},
    });

    expect(executed).toEqual(['step-one', 'step-two']);

    expect(result.status).toBe('business_outcome');
  });

  it('stops immediately when human intervention is required', async () => {
    const executed: string[] = [];

    const execute = vi.fn<ReplayStepExecutor['execute']>((step) => {
      executed.push(step.id);

      if (step.id === 'step-two') {
        return Promise.resolve({
          status: 'intervention_required',
          reasonCode: 'HUMAN_APPROVAL_REQUIRED',
          reason: 'Policy requires human approval.',
        } satisfies ReplayOrderedStepResult);
      }

      return Promise.resolve({
        status: 'success',
      } satisfies ReplayOrderedStepResult);
    });

    const executor: ReplayStepExecutor = {
      execute,
    };

    const engine = new ReplayEngine({
      artifactStore: artifactStore(),
      stepExecutor: executor,
    });

    const result = await engine.runOrderedSteps({
      capabilityId: 'ordered_test',
      version: '1.0.0',
      inputs: {},
    });

    expect(executed).toEqual(['step-one', 'step-two']);

    expect(result.status).toBe('intervention_required');
  });

  it('does not execute any step when invocation validation fails', async () => {
    const artifactWithInput: CapabilityArtifact = {
      ...artifact,

      inputs: [
        {
          name: 'memberName',
          type: 'string',
          required: true,
          description: 'Member name.',
          sensitive: true,
        },
      ],
    };

    const store = {
      load: vi.fn(() => Promise.resolve(artifactWithInput)),
    } satisfies Pick<ArtifactStore, 'load'>;

    const execute = vi.fn<ReplayStepExecutor['execute']>(() =>
      Promise.resolve({
        status: 'success',
      } satisfies ReplayOrderedStepResult),
    );

    const executor: ReplayStepExecutor = {
      execute,
    };

    const engine = new ReplayEngine({
      artifactStore: store,
      stepExecutor: executor,
    });

    const result = await engine.runOrderedSteps({
      capabilityId: 'ordered_test',
      version: '1.0.0',
      inputs: {},
    });

    expect(execute).not.toHaveBeenCalled();
    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('INVALID_INPUT');

      expect(result.stepsExecuted).toBe(0);
    }
  });
});
