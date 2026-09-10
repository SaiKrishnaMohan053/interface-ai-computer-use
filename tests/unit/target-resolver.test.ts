import { describe, expect, it, vi } from 'vitest';

import type { SurfaceAdapter, TargetResolutionResult } from '../../src/surface/adapter.js';

import type { ResolvedTarget } from '../../src/surface/contracts.js';

import { TargetResolver } from '../../src/targeting/index.js';

import type { TargetStrategy } from '../../src/targeting/index.js';

const target = {
  description: 'Search button',
  cardinality: 'exactly-one',

  strategies: [
    {
      kind: 'text',

      text: {
        value: 'Missing',
        mode: 'exact',
        caseSensitive: true,
      },
    },
    {
      kind: 'css',
      selector: 'button',
    },
  ],
};

const resolvedTarget: ResolvedTarget = {
  sessionId: 'session',
  surfaceId: 'page',
  resolutionId: 'resolution',
  observationId: 'observation',
  resolvedAt: new Date(0).toISOString(),
  description: 'Search button',
  matchedStrategyIndex: 1,
  cardinality: 'exactly-one',
};

function resolverWith(results: TargetResolutionResult[]) {
  const resolveTarget = vi.fn(() => {
    const result = results.shift();

    return result ? Promise.resolve(result) : Promise.reject(new Error('Unexpected strategy call'));
  });

  const adapter = {
    resolveTarget,
  } as unknown as SurfaceAdapter<TargetStrategy>;

  return {
    resolver: new TargetResolver(adapter),
    resolveTarget,
  };
}

describe('TargetResolver', () => {
  it('moves past zero matches and returns the first exactly-one result', async () => {
    const { resolver, resolveTarget } = resolverWith([
      {
        status: 'not_found',
        matchCount: 0,
      },
      {
        status: 'resolved',
        target: resolvedTarget,
      },
    ]);

    const result = await resolver.resolve(
      {
        observationId: 'observation',
        target,
      },
      {
        timeoutMs: 1000,
      },
    );

    expect(result.status).toBe('resolved');

    expect(resolveTarget).toHaveBeenCalledTimes(2);

    expect(result.attempts.map((attempt) => attempt.outcome)).toEqual(['not-found', 'resolved']);
  });

  it('moves past ambiguity instead of selecting the first match', async () => {
    const { resolver } = resolverWith([
      {
        status: 'ambiguous',
        matchCount: 3,
      },
      {
        status: 'resolved',
        target: resolvedTarget,
      },
    ]);

    const result = await resolver.resolve(
      {
        observationId: 'observation',
        target,
      },
      {
        timeoutMs: 1000,
      },
    );

    expect(result.status).toBe('resolved');

    expect(result.attempts[0]).toMatchObject({
      outcome: 'ambiguous',
      matchCount: 3,
    });
  });

  it('returns TARGET_NOT_FOUND when every strategy has zero matches', async () => {
    const { resolver } = resolverWith([
      {
        status: 'not_found',
        matchCount: 0,
      },
      {
        status: 'not_found',
        matchCount: 0,
      },
    ]);

    expect(
      await resolver.resolve(
        {
          observationId: 'observation',
          target,
        },
        {
          timeoutMs: 1000,
        },
      ),
    ).toMatchObject({
      status: 'failure',
      error: {
        code: 'TARGET_NOT_FOUND',
      },
    });
  });

  it('returns TARGET_AMBIGUOUS if any exhausted strategy was ambiguous', async () => {
    const { resolver } = resolverWith([
      {
        status: 'ambiguous',
        matchCount: 2,
      },
      {
        status: 'not_found',
        matchCount: 0,
      },
    ]);

    expect(
      await resolver.resolve(
        {
          observationId: 'observation',
          target,
        },
        {
          timeoutMs: 1000,
        },
      ),
    ).toMatchObject({
      status: 'failure',
      error: {
        code: 'TARGET_AMBIGUOUS',
      },
    });
  });

  it('stops and propagates an adapter failure', async () => {
    const error = {
      code: 'STALE_TARGET' as const,
      message: 'Observation is stale',
      expected: null,
      observed: null,
    };

    const { resolver, resolveTarget } = resolverWith([
      {
        status: 'failure',
        error,
      },
    ]);

    expect(
      await resolver.resolve(
        {
          observationId: 'observation',
          target,
        },
        {
          timeoutMs: 1000,
        },
      ),
    ).toMatchObject({
      status: 'failure',
      error: {
        code: 'STALE_TARGET',
      },
    });

    expect(resolveTarget).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid target input before calling the adapter', async () => {
    const { resolver, resolveTarget } = resolverWith([]);

    expect(
      await resolver.resolve(
        {
          observationId: 'observation',

          target: {
            description: 'invalid',
          },
        },
        {
          timeoutMs: 1000,
        },
      ),
    ).toMatchObject({
      status: 'failure',

      error: {
        code: 'ACTION_FAILED',
      },

      attempts: [],
    });

    expect(resolveTarget).not.toHaveBeenCalled();
  });
});
