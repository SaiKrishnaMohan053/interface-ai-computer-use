import { describe, expect, it, vi } from 'vitest';

import type { SurfaceAdapter } from '../../src/surface/index.js';

import { TargetResolver, createTableCellTargetSpec } from '../../src/targeting/index.js';

import type { TargetSpec, TargetStrategy } from '../../src/targeting/index.js';

const scope = {
  sessionId: 'replay-session',

  surfaceId: 'replay-surface',
} as const;

function resolvedTarget(strategyIndex: number) {
  return {
    ...scope,

    resolutionId: `resolution-${strategyIndex}`,

    observationId: 'observation-1',

    resolvedAt: '2026-09-20T22:00:00.000Z',

    description: 'resolved replay target',

    matchedStrategyIndex: strategyIndex,

    cardinality: 'exactly-one' as const,
  };
}

type ResolveTargetImplementation = SurfaceAdapter<TargetStrategy>['resolveTarget'];

function adapter(resolveTarget: ResolveTargetImplementation): SurfaceAdapter<TargetStrategy> {
  return {
    scope,

    observe: vi.fn(() => Promise.reject(new Error('observe not used'))),

    resolveTarget,

    perform: vi.fn(() => Promise.reject(new Error('perform not used'))),

    evaluate: vi.fn(() => Promise.reject(new Error('evaluate not used'))),

    captureEvidence: vi.fn(() => Promise.reject(new Error('captureEvidence not used'))),
  };
}

function exactSemanticTarget(): TargetSpec {
  return {
    description: 'Accounts button',

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
  };
}

function targetWithFallback(): TargetSpec {
  return {
    description: 'Accounts button',

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

      {
        kind: 'text',

        text: {
          value: 'Accounts',

          mode: 'exact',

          caseSensitive: false,
        },
      },
    ],
  };
}

describe('replay target resolution scenarios', () => {
  it('resolves an exact semantic target', async () => {
    const resolveTarget = vi.fn<ResolveTargetImplementation>((request) =>
      Promise.resolve({
        status: 'resolved',

        target: resolvedTarget(request.strategyIndex),
      }),
    );

    const resolver = new TargetResolver(adapter(resolveTarget));

    const result = await resolver.resolve(
      {
        observationId: 'observation-1',

        target: exactSemanticTarget(),
      },

      {
        timeoutMs: 2_000,
      },
    );

    expect(result.status).toBe('resolved');

    if (result.status === 'resolved') {
      expect(result.target.matchedStrategyIndex).toBe(0);

      expect(result.attempts).toEqual([
        {
          strategyIndex: 0,

          strategyKind: 'role-name',

          outcome: 'resolved',

          matchCount: 1,
        },
      ]);
    }

    expect(resolveTarget).toHaveBeenCalledTimes(1);
  });

  it('uses the next persisted strategy when the first semantic strategy is not found', async () => {
    const resolveTarget = vi.fn<ResolveTargetImplementation>((request) => {
      if (request.strategyIndex === 0) {
        return Promise.resolve({
          status: 'not_found',

          matchCount: 0,
        });
      }

      return Promise.resolve({
        status: 'resolved',

        target: resolvedTarget(request.strategyIndex),
      });
    });

    const resolver = new TargetResolver(adapter(resolveTarget));

    const result = await resolver.resolve(
      {
        observationId: 'observation-1',

        target: targetWithFallback(),
      },

      {
        timeoutMs: 2_000,
      },
    );

    expect(result.status).toBe('resolved');

    if (result.status === 'resolved') {
      expect(result.target.matchedStrategyIndex).toBe(1);

      expect(result.attempts).toEqual([
        {
          strategyIndex: 0,

          strategyKind: 'role-name',

          outcome: 'not-found',

          matchCount: 0,
        },

        {
          strategyIndex: 1,

          strategyKind: 'text',

          outcome: 'resolved',

          matchCount: 1,
        },
      ]);
    }

    expect(resolveTarget).toHaveBeenCalledTimes(2);
  });

  it('returns TARGET_NOT_FOUND when every persisted strategy misses', async () => {
    const resolveTarget = vi.fn<ResolveTargetImplementation>(() =>
      Promise.resolve({
        status: 'not_found',

        matchCount: 0,
      }),
    );

    const resolver = new TargetResolver(adapter(resolveTarget));

    const result = await resolver.resolve(
      {
        observationId: 'observation-1',

        target: targetWithFallback(),
      },

      {
        timeoutMs: 2_000,
      },
    );

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('TARGET_NOT_FOUND');

      expect(result.attempts).toHaveLength(2);
    }
  });

  it('fails with TARGET_AMBIGUOUS rather than guessing when the target remains ambiguous', async () => {
    const resolveTarget = vi.fn<ResolveTargetImplementation>(() =>
      Promise.resolve({
        status: 'ambiguous',

        matchCount: 2,
      }),
    );

    const resolver = new TargetResolver(adapter(resolveTarget));

    const result = await resolver.resolve(
      {
        observationId: 'observation-1',

        target: exactSemanticTarget(),
      },

      {
        timeoutMs: 2_000,
      },
    );

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('TARGET_AMBIGUOUS');

      expect(result.attempts).toEqual([
        {
          strategyIndex: 0,

          strategyKind: 'role-name',

          outcome: 'ambiguous',

          matchCount: 2,
        },
      ]);
    }
  });

  it('resolves the Savings Current Balance using the persisted structural table-cell strategy', async () => {
    const target = createTableCellTargetSpec({
      description: 'Savings Current Balance cell in Accounts table',

      tableName: {
        value: 'Accounts',

        mode: 'contains',

        caseSensitive: false,
      },

      rowColumnHeader: {
        value: 'Account Type',

        mode: 'exact',

        caseSensitive: false,
      },

      rowValue: {
        value: 'Savings',

        mode: 'exact',

        caseSensitive: false,
      },

      resultColumnHeader: {
        value: 'Current Balance',

        mode: 'exact',

        caseSensitive: false,
      },
    });

    const resolveTarget = vi.fn<ResolveTargetImplementation>((request) => {
      expect(request.strategy.kind).toBe('structural');

      if (request.strategy.kind !== 'structural') {
        throw new Error('Expected structural strategy');
      }

      expect(request.strategy.query).toEqual({
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
      });

      return Promise.resolve({
        status: 'resolved',

        target: resolvedTarget(0),
      });
    });

    const resolver = new TargetResolver(adapter(resolveTarget));

    const result = await resolver.resolve(
      {
        observationId: 'observation-1',

        target,
      },

      {
        timeoutMs: 2_000,
      },
    );

    expect(result.status).toBe('resolved');

    if (result.status === 'resolved') {
      expect(result.attempts).toEqual([
        {
          strategyIndex: 0,

          strategyKind: 'structural',

          outcome: 'resolved',

          matchCount: 1,
        },
      ]);
    }

    expect(resolveTarget).toHaveBeenCalledTimes(1);
  });

  it('does not fall back after an adapter execution failure', async () => {
    const resolveTarget = vi.fn<ResolveTargetImplementation>(() =>
      Promise.resolve({
        status: 'failure',

        error: {
          code: 'SURFACE_UNAVAILABLE',

          message: 'Surface unavailable.',

          expected: null,

          observed: null,
        },
      }),
    );

    const resolver = new TargetResolver(adapter(resolveTarget));

    const result = await resolver.resolve(
      {
        observationId: 'observation-1',

        target: targetWithFallback(),
      },

      {
        timeoutMs: 2_000,
      },
    );

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('SURFACE_UNAVAILABLE');
    }

    expect(resolveTarget).toHaveBeenCalledTimes(1);
  });
});
