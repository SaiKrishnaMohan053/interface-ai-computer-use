import type { SurfaceAdapter, SurfaceOperationOptions } from '../surface/adapter.js';

import type { ResolvedTarget, SurfaceFailure } from '../surface/contracts.js';

import { targetSpecSchema } from './target-spec.js';

import type { TargetSpec, TargetStrategy } from './target-spec.js';

export interface TargetResolverRequest {
  readonly observationId: string;
  readonly target: unknown;
}

export interface TargetResolutionAttempt {
  readonly strategyIndex: number;
  readonly strategyKind: TargetStrategy['kind'];

  readonly outcome: 'not-found' | 'ambiguous' | 'resolved' | 'failure';

  readonly matchCount: number | null;
}

export type TargetResolverResult =
  | {
      readonly status: 'resolved';
      readonly target: ResolvedTarget;
      readonly spec: TargetSpec;
      readonly attempts: readonly TargetResolutionAttempt[];
    }
  | {
      readonly status: 'failure';
      readonly error: SurfaceFailure;
      readonly attempts: readonly TargetResolutionAttempt[];
    };

const invalidFailure = (message: string): SurfaceFailure => ({
  code: 'ACTION_FAILED',
  message,
  expected: null,
  observed: null,
});

export class TargetResolver {
  constructor(private readonly adapter: SurfaceAdapter<TargetStrategy>) {}

  async resolve(
    request: TargetResolverRequest,
    options: SurfaceOperationOptions,
  ): Promise<TargetResolverResult> {
    const parsed = targetSpecSchema.safeParse(request.target);

    if (!parsed.success) {
      return {
        status: 'failure',
        error: invalidFailure('Target specification is invalid'),
        attempts: [],
      };
    }

    if (request.observationId.trim().length === 0) {
      return {
        status: 'failure',
        error: invalidFailure('Observation ID must not be empty'),
        attempts: [],
      };
    }

    if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
      return {
        status: 'failure',
        error: invalidFailure('Resolution timeout must be positive and finite'),
        attempts: [],
      };
    }

    const spec = parsed.data;
    const startedAt = Date.now();

    const attempts: TargetResolutionAttempt[] = [];

    let sawAmbiguous = false;

    for (const [strategyIndex, strategy] of spec.strategies.entries()) {
      const remaining = options.timeoutMs - (Date.now() - startedAt);

      if (remaining <= 0) {
        return {
          status: 'failure',
          error: invalidFailure('Target resolution budget was exhausted'),
          attempts,
        };
      }

      const result = await this.adapter.resolveTarget(
        {
          observationId: request.observationId,

          description: spec.description,
          strategyIndex,
          strategy,
        },
        {
          timeoutMs: remaining,

          ...(options.signal === undefined ? {} : { signal: options.signal }),
        },
      );

      switch (result.status) {
        case 'resolved':
          attempts.push({
            strategyIndex,
            strategyKind: strategy.kind,
            outcome: 'resolved',
            matchCount: 1,
          });

          return {
            status: 'resolved',
            target: result.target,
            spec,
            attempts,
          };

        case 'not_found':
          attempts.push({
            strategyIndex,
            strategyKind: strategy.kind,
            outcome: 'not-found',
            matchCount: 0,
          });

          break;

        case 'ambiguous':
          sawAmbiguous = true;

          attempts.push({
            strategyIndex,
            strategyKind: strategy.kind,
            outcome: 'ambiguous',
            matchCount: result.matchCount,
          });

          break;

        case 'failure':
          attempts.push({
            strategyIndex,
            strategyKind: strategy.kind,
            outcome: 'failure',
            matchCount: null,
          });

          return {
            status: 'failure',
            error: result.error,
            attempts,
          };
      }
    }

    return {
      status: 'failure',

      error: {
        code: sawAmbiguous ? 'TARGET_AMBIGUOUS' : 'TARGET_NOT_FOUND',

        message: sawAmbiguous
          ? 'No targeting strategy resolved exactly one element; at least one was ambiguous'
          : 'No targeting strategy matched an element',

        expected: 'exactly-one',

        observed: attempts.map((attempt) => ({
          strategyIndex: attempt.strategyIndex,

          strategyKind: attempt.strategyKind,

          outcome: attempt.outcome,
          matchCount: attempt.matchCount,
        })),
      },

      attempts,
    };
  }
}
