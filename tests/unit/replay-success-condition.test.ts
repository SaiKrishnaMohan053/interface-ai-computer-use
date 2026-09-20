import { describe, expect, it, vi } from 'vitest';

import { evaluateReplaySuccessCondition, ReplayOutputStore } from '../../src/replay/index.js';

import type {
  ArtifactSuccessCondition,
  ArtifactSuccessLeaf,
  CapabilityArtifact,
  WaitPolicy,
} from '../../src/artifact/index.js';

import type { ConditionResult, SurfaceAdapter } from '../../src/surface/index.js';

import type { TargetStrategy } from '../../src/targeting/index.js';

const scope = {
  sessionId: 'replay-session',
  surfaceId: 'replay-surface',
} as const;

const wait: WaitPolicy = {
  timeoutMs: 5_000,
  pollIntervalMs: 100,
};

const artifact: Pick<CapabilityArtifact, 'outputs'> = {
  outputs: [
    {
      name: 'savingsBalance',
      type: 'currency',
      required: true,
      description: 'Current Savings account balance.',
    },
  ],
};

function outputStore(savingsBalance?: string): ReplayOutputStore {
  const store = new ReplayOutputStore(artifact);

  if (savingsBalance !== undefined) {
    const stored = store.store(
      {
        kind: 'outputRef',
        name: 'savingsBalance',
      },
      savingsBalance,
    );

    expect(stored.status).toBe('stored');
  }

  return store;
}

function surfaceCondition(text = 'Savings'): ArtifactSuccessLeaf {
  return {
    kind: 'surface',
    condition: {
      kind: 'textPresent',
      text,
      match: 'contains',
      caseSensitive: false,
    },
  };
}

function outputPresentCondition(): ArtifactSuccessLeaf {
  return {
    kind: 'outputPresent',
    output: {
      kind: 'outputRef',
      name: 'savingsBalance',
    },
  };
}

function conditionResult(passed: boolean, conditionId: string): ConditionResult {
  const base = {
    ...scope,
    conditionId,
    startedAt: '2026-09-20T20:00:00.000Z',
    finishedAt: '2026-09-20T20:00:00.001Z',
    durationMs: 1,
    attempts: 1,
    expected: true,
    observed: passed,
    evidenceRefs: [],
  } as const;

  return passed
    ? {
        ...base,
        status: 'passed',
        passed: true,
      }
    : {
        ...base,
        status: 'not_met',
        passed: false,
        reason: 'mismatch',
      };
}

function adapterWithEvaluate(
  evaluate: SurfaceAdapter<TargetStrategy>['evaluate'],
): SurfaceAdapter<TargetStrategy> {
  return {
    scope,

    observe: vi.fn(() => {
      throw new Error('observe should not be called directly by this test');
    }),

    resolveTarget: vi.fn(() => {
      throw new Error('resolveTarget should not be called directly by this test');
    }),

    perform: vi.fn(() => {
      throw new Error('perform should not be called');
    }),

    evaluate,

    captureEvidence: vi.fn(() => {
      throw new Error('captureEvidence should not be called');
    }),
  };
}

function alwaysSurface(passed: boolean): SurfaceAdapter<TargetStrategy> {
  const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>((request) =>
    Promise.resolve(conditionResult(passed, request.conditionId)),
  );

  return adapterWithEvaluate(evaluate);
}

describe('replay success condition', () => {
  it('passes a satisfied surface leaf', async () => {
    const result = await evaluateReplaySuccessCondition({
      adapter: alwaysSurface(true),
      condition: surfaceCondition(),
      outputStore: outputStore(),
      wait,
    });

    expect(result.status).toBe('passed');
  });

  it('passes outputPresent when the declared output exists', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>(() =>
      Promise.reject(new Error('surface evaluation should not be called')),
    );

    const result = await evaluateReplaySuccessCondition({
      adapter: adapterWithEvaluate(evaluate),
      condition: outputPresentCondition(),
      outputStore: outputStore('$12,840.50'),
      wait,
    });

    expect(result.status).toBe('passed');

    expect(evaluate).not.toHaveBeenCalled();
  });

  it('returns CHECKPOINT_FAILED when outputPresent is missing', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>(() =>
      Promise.reject(new Error('surface evaluation should not be called')),
    );

    const result = await evaluateReplaySuccessCondition({
      adapter: adapterWithEvaluate(evaluate),
      condition: outputPresentCondition(),
      outputStore: outputStore(),
      wait,
    });

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('CHECKPOINT_FAILED');

      expect(result.error.details.phase).toBe('success_condition');

      expect(result.error.details.reason).toBe('FINAL_SUCCESS_CONDITION_NOT_MET');
    }
  });

  it('passes all when every child condition passes', async () => {
    const condition: ArtifactSuccessCondition = {
      kind: 'all',
      conditions: [surfaceCondition('Savings'), outputPresentCondition()],
    };

    const result = await evaluateReplaySuccessCondition({
      adapter: alwaysSurface(true),
      condition,
      outputStore: outputStore('$12,840.50'),
      wait,
    });

    expect(result.status).toBe('passed');
  });

  it('fails all when one child condition fails', async () => {
    const condition: ArtifactSuccessCondition = {
      kind: 'all',
      conditions: [surfaceCondition('Savings'), outputPresentCondition()],
    };

    const result = await evaluateReplaySuccessCondition({
      adapter: alwaysSurface(true),
      condition,
      outputStore: outputStore(),
      wait,
    });

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('CHECKPOINT_FAILED');
    }
  });

  it('passes any when one child condition succeeds', async () => {
    const condition: ArtifactSuccessCondition = {
      kind: 'any',
      conditions: [surfaceCondition('Savings'), outputPresentCondition()],
    };

    const result = await evaluateReplaySuccessCondition({
      adapter: alwaysSurface(false),
      condition,
      outputStore: outputStore('$12,840.50'),
      wait,
    });

    expect(result.status).toBe('passed');
  });

  it('fails any when every child condition fails', async () => {
    const condition: ArtifactSuccessCondition = {
      kind: 'any',
      conditions: [surfaceCondition('Savings'), outputPresentCondition()],
    };

    const result = await evaluateReplaySuccessCondition({
      adapter: alwaysSurface(false),
      condition,
      outputStore: outputStore(),
      wait,
    });

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('CHECKPOINT_FAILED');
    }
  });

  it('implements not semantics by inverting the child result', async () => {
    const condition: ArtifactSuccessCondition = {
      kind: 'not',
      condition: surfaceCondition('Application error'),
    };

    const result = await evaluateReplaySuccessCondition({
      adapter: alwaysSurface(false),
      condition,
      outputStore: outputStore(),
      wait,
    });

    expect(result.status).toBe('passed');
  });

  it('does not treat completed step execution as success when the final condition is unsatisfied', async () => {
    /*
     * ReplayEngine may have executed every artifact step before
     * reaching this evaluator. That fact is intentionally absent
     * from this API: final success still requires the declared
     * success condition itself to pass.
     */

    const result = await evaluateReplaySuccessCondition({
      adapter: alwaysSurface(true),
      condition: outputPresentCondition(),
      outputStore: outputStore(),
      wait,
    });

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('CHECKPOINT_FAILED');
    }
  });

  it('passes the lookup_savings_balance equivalent only when Savings context and savingsBalance both exist', async () => {
    const condition: ArtifactSuccessCondition = {
      kind: 'all',

      conditions: [
        {
          kind: 'surface',
          condition: {
            kind: 'textPresent',
            text: 'Savings',
            match: 'contains',
            caseSensitive: false,
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
    };

    const result = await evaluateReplaySuccessCondition({
      adapter: alwaysSurface(true),
      condition,
      outputStore: outputStore('$12,840.50'),
      wait,
    });

    expect(result.status).toBe('passed');
  });

  it('fails the lookup success condition when Savings context exists but savingsBalance is missing', async () => {
    const condition: ArtifactSuccessCondition = {
      kind: 'all',
      conditions: [surfaceCondition('Savings'), outputPresentCondition()],
    };

    const result = await evaluateReplaySuccessCondition({
      adapter: alwaysSurface(true),
      condition,
      outputStore: outputStore(),
      wait,
    });

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('CHECKPOINT_FAILED');
    }
  });

  it('fails the lookup success condition when savingsBalance exists but Savings context is missing', async () => {
    const condition: ArtifactSuccessCondition = {
      kind: 'all',
      conditions: [surfaceCondition('Savings'), outputPresentCondition()],
    };

    const result = await evaluateReplaySuccessCondition({
      adapter: alwaysSurface(false),
      condition,
      outputStore: outputStore('$12,840.50'),
      wait,
    });

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('CHECKPOINT_FAILED');

      expect(result.error.details.phase).toBe('success_condition');
    }
  });
});
