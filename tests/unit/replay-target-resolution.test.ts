import { describe, expect, it, vi } from 'vitest';

import { resolveReplayStepTarget } from '../../src/replay/index.js';

import type { CapabilityStep } from '../../src/artifact/index.js';

import type { ResolvedTarget, SurfaceAdapter } from '../../src/surface/index.js';

import type { TargetStrategy } from '../../src/targeting/index.js';

const scope = {
  sessionId: 'replay-session',
  surfaceId: 'replay-surface',
} as const;

function resolvedTarget(observationId: string, strategyIndex: number): ResolvedTarget {
  return {
    ...scope,
    resolutionId: `resolution-${strategyIndex}`,
    observationId,
    resolvedAt: '2026-09-20T19:00:00.000Z',
    description: 'Resolved replay target',
    matchedStrategyIndex: strategyIndex,
    cardinality: 'exactly-one',
  };
}

function targetStep(
  strategies: readonly TargetStrategy[] = [
    {
      kind: 'text',
      text: {
        value: 'Search',
        mode: 'exact',
        caseSensitive: false,
      },
    },
  ],
): CapabilityStep {
  return {
    id: 'submit-member-search',
    description: 'Submit member search.',
    action: {
      kind: 'click',
    },
    target: {
      description: 'Search button',
      cardinality: 'exactly-one',
      strategies: [...strategies],
    },
    risk: 'READ_ONLY',
  };
}

function adapterWithResolver(
  resolveTarget: SurfaceAdapter<TargetStrategy>['resolveTarget'],
): SurfaceAdapter<TargetStrategy> {
  return {
    scope,

    observe: vi.fn(() => {
      throw new Error('observe should not be called');
    }),

    resolveTarget,

    perform: vi.fn(() => {
      throw new Error('perform should not be called');
    }),

    evaluate: vi.fn(() => {
      throw new Error('evaluate should not be called');
    }),

    captureEvidence: vi.fn(() => {
      throw new Error('captureEvidence should not be called');
    }),
  };
}

describe('replay target resolution', () => {
  it('resolves a target-bearing click through TargetResolver', async () => {
    const resolveTarget = vi.fn<SurfaceAdapter<TargetStrategy>['resolveTarget']>((request) =>
      Promise.resolve({
        status: 'resolved',
        target: resolvedTarget(request.observationId, request.strategyIndex),
      }),
    );

    const adapter = adapterWithResolver(resolveTarget);

    const result = await resolveReplayStepTarget({
      adapter,
      step: targetStep(),
      observationId: 'observation-1',
      timeoutMs: 5_000,
    });

    expect(result.status).toBe('resolved');
    expect(resolveTarget).toHaveBeenCalledTimes(1);

    if (result.status === 'resolved') {
      expect(result.target.observationId).toBe('observation-1');

      expect(result.target.matchedStrategyIndex).toBe(0);

      expect(result.attempts).toEqual([
        {
          strategyIndex: 0,
          strategyKind: 'text',
          outcome: 'resolved',
          matchCount: 1,
        },
      ]);
    }
  });

  it('falls back after zero matches and resolves with the next strategy', async () => {
    const strategies: TargetStrategy[] = [
      {
        kind: 'text',
        text: {
          value: 'Search',
          mode: 'exact',
          caseSensitive: false,
        },
      },
      {
        kind: 'role-name',
        role: 'button',
        name: {
          value: 'Search',
          mode: 'exact',
          caseSensitive: false,
        },
      },
    ];

    const resolveTarget = vi.fn<SurfaceAdapter<TargetStrategy>['resolveTarget']>((request) => {
      if (request.strategyIndex === 0) {
        return Promise.resolve({
          status: 'not_found',
          matchCount: 0,
        });
      }

      return Promise.resolve({
        status: 'resolved',
        target: resolvedTarget(request.observationId, request.strategyIndex),
      });
    });

    const result = await resolveReplayStepTarget({
      adapter: adapterWithResolver(resolveTarget),
      step: targetStep(strategies),
      observationId: 'observation-2',
      timeoutMs: 5_000,
    });

    expect(result.status).toBe('resolved');
    expect(resolveTarget).toHaveBeenCalledTimes(2);

    if (result.status === 'resolved') {
      expect(result.target.matchedStrategyIndex).toBe(1);

      expect(result.attempts).toEqual([
        {
          strategyIndex: 0,
          strategyKind: 'text',
          outcome: 'not-found',
          matchCount: 0,
        },
        {
          strategyIndex: 1,
          strategyKind: 'role-name',
          outcome: 'resolved',
          matchCount: 1,
        },
      ]);
    }
  });

  it('falls back after ambiguity and resolves with a later strategy', async () => {
    const strategies: TargetStrategy[] = [
      {
        kind: 'text',
        text: {
          value: 'Accounts',
          mode: 'exact',
          caseSensitive: false,
        },
      },
      {
        kind: 'role-name',
        role: 'link',
        name: {
          value: 'Accounts',
          mode: 'exact',
          caseSensitive: false,
        },
      },
    ];

    const resolveTarget = vi.fn<SurfaceAdapter<TargetStrategy>['resolveTarget']>((request) => {
      if (request.strategyIndex === 0) {
        return Promise.resolve({
          status: 'ambiguous',
          matchCount: 2,
        });
      }

      return Promise.resolve({
        status: 'resolved',
        target: resolvedTarget(request.observationId, request.strategyIndex),
      });
    });

    const result = await resolveReplayStepTarget({
      adapter: adapterWithResolver(resolveTarget),
      step: targetStep(strategies),
      observationId: 'observation-3',
      timeoutMs: 5_000,
    });

    expect(result.status).toBe('resolved');
    expect(resolveTarget).toHaveBeenCalledTimes(2);

    if (result.status === 'resolved') {
      expect(result.target.matchedStrategyIndex).toBe(1);

      expect(result.attempts[0]).toEqual({
        strategyIndex: 0,
        strategyKind: 'text',
        outcome: 'ambiguous',
        matchCount: 2,
      });
    }
  });

  it('returns TARGET_NOT_FOUND when every strategy has zero matches', async () => {
    const strategies: TargetStrategy[] = [
      {
        kind: 'text',
        text: {
          value: 'Missing',
          mode: 'exact',
          caseSensitive: false,
        },
      },
      {
        kind: 'role-name',
        role: 'button',
        name: {
          value: 'Missing',
          mode: 'exact',
          caseSensitive: false,
        },
      },
    ];

    const resolveTarget = vi.fn<SurfaceAdapter<TargetStrategy>['resolveTarget']>(() =>
      Promise.resolve({
        status: 'not_found',
        matchCount: 0,
      }),
    );

    const result = await resolveReplayStepTarget({
      adapter: adapterWithResolver(resolveTarget),
      step: targetStep(strategies),
      observationId: 'observation-4',
      timeoutMs: 5_000,
    });

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('TARGET_NOT_FOUND');

      expect(result.attempts).toHaveLength(2);
    }

    expect(resolveTarget).toHaveBeenCalledTimes(2);
  });

  it('returns TARGET_AMBIGUOUS when no fallback resolves an ambiguous target', async () => {
    const strategies: TargetStrategy[] = [
      {
        kind: 'text',
        text: {
          value: 'Accounts',
          mode: 'exact',
          caseSensitive: false,
        },
      },
      {
        kind: 'role-name',
        role: 'link',
        name: {
          value: 'Accounts',
          mode: 'exact',
          caseSensitive: false,
        },
      },
    ];

    const resolveTarget = vi.fn<SurfaceAdapter<TargetStrategy>['resolveTarget']>((request) =>
      request.strategyIndex === 0
        ? Promise.resolve({
            status: 'ambiguous',
            matchCount: 3,
          })
        : Promise.resolve({
            status: 'not_found',
            matchCount: 0,
          }),
    );

    const result = await resolveReplayStepTarget({
      adapter: adapterWithResolver(resolveTarget),
      step: targetStep(strategies),
      observationId: 'observation-5',
      timeoutMs: 5_000,
    });

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('TARGET_AMBIGUOUS');

      expect(result.attempts).toHaveLength(2);
    }
  });

  it('fails closed when a target-bearing action has no target', async () => {
    const step: CapabilityStep = {
      id: 'missing-target',
      description: 'Invalid target-bearing step.',
      action: {
        kind: 'click',
      },
      risk: 'READ_ONLY',
    };

    const resolveTarget = vi.fn<SurfaceAdapter<TargetStrategy>['resolveTarget']>(() =>
      Promise.reject(new Error('resolveTarget should not be called')),
    );

    const result = await resolveReplayStepTarget({
      adapter: adapterWithResolver(resolveTarget),
      step,
      observationId: 'observation-6',
      timeoutMs: 5_000,
    });

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('ACTION_FAILED');

      expect(result.error.observed).toBe('missing');
    }

    expect(resolveTarget).not.toHaveBeenCalled();
  });

  it('rejects non-target-bearing actions instead of inventing a target', async () => {
    const step: CapabilityStep = {
      id: 'navigate-step',
      description: 'Navigate.',
      action: {
        kind: 'navigate',
        destination: 'http://localhost:3000/member-search',
      },
      risk: 'READ_ONLY',
    };

    const resolveTarget = vi.fn<SurfaceAdapter<TargetStrategy>['resolveTarget']>(() =>
      Promise.reject(new Error('resolveTarget should not be called')),
    );

    const result = await resolveReplayStepTarget({
      adapter: adapterWithResolver(resolveTarget),
      step,
      observationId: 'observation-7',
      timeoutMs: 5_000,
    });

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('ACTION_FAILED');

      expect(result.error.observed).toBe('navigate');
    }

    expect(resolveTarget).not.toHaveBeenCalled();
  });
});
