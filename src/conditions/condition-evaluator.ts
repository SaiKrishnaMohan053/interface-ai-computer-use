import type {
  ConditionResult,
  ConditionTarget,
  ConditionWaitOptions,
  ObservationOptions,
  SurfaceAdapter,
  SurfaceCondition,
  SurfaceFailure,
} from '../surface/index.js';
import { TargetResolver } from '../targeting/target-resolver.js';
import type { TargetSpec, TargetStrategy } from '../targeting/target-spec.js';
import { conditionSpecSchema } from './condition-spec.js';
import type { ConditionSpec } from './condition-spec.js';

export interface ConditionEvaluatorRequest {
  readonly conditionId: string;
  readonly condition: unknown;
}

export interface ConditionEvaluatorOptions extends ConditionWaitOptions {
  readonly signal?: AbortSignal;
}

export interface ConditionObservationLimits {
  readonly maxTextLength: number;
  readonly maxControls: number;
}

const defaultObservationLimits: ConditionObservationLimits = {
  maxTextLength: 20_000,
  maxControls: 200,
};

const invalidCondition = (message: string): SurfaceFailure => ({
  code: 'CONDITION_EVALUATION_FAILED',
  message,
  expected: 'valid condition specification',
  observed: 'invalid condition specification',
});

export class ConditionEvaluator {
  private readonly resolver: TargetResolver;

  constructor(
    private readonly adapter: SurfaceAdapter<TargetStrategy>,
    private readonly observationLimits: ConditionObservationLimits = defaultObservationLimits,
  ) {
    this.resolver = new TargetResolver(adapter);
  }

  async evaluate(
    request: ConditionEvaluatorRequest,
    options: ConditionEvaluatorOptions,
  ): Promise<ConditionResult> {
    const startedAt = Date.now();
    const conditionId = request.conditionId.trim();
    const parsed = conditionSpecSchema.safeParse(request.condition);

    if (conditionId.length === 0 || !parsed.success) {
      const finishedAt = Date.now();

      return {
        ...this.adapter.scope,
        conditionId,
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date(finishedAt).toISOString(),
        durationMs: finishedAt - startedAt,
        attempts: 0,
        expected: 'valid condition specification',
        observed:
          conditionId.length === 0 ? 'empty condition ID' : 'invalid condition specification',
        evidenceRefs: [],
        status: 'error',
        passed: false,
        error: invalidCondition(
          conditionId.length === 0
            ? 'Condition ID must not be empty'
            : 'Condition specification is invalid',
        ),
      };
    }

    return this.adapter.evaluate(
      {
        conditionId,
        prepare: (operation) => this.prepare(parsed.data, operation),
      },
      options,
    );
  }

  private async prepare(
    condition: ConditionSpec,
    operation: {
      readonly timeoutMs: number;
      readonly signal?: AbortSignal;
    },
  ): Promise<
    | {
        readonly status: 'ready';
        readonly condition: SurfaceCondition<ConditionTarget>;
      }
    | {
        readonly status: 'failure';
        readonly error: SurfaceFailure;
      }
  > {
    if (!this.hasTarget(condition)) {
      return { status: 'ready', condition };
    }

    const observationOptions: ObservationOptions = {
      ...operation,
      ...this.observationLimits,
    };

    const observation = await this.adapter.observe(observationOptions);

    if (observation.status === 'failure') {
      return observation;
    }

    const resolved = await this.resolver.resolve(
      {
        observationId: observation.observation.observationId,
        target: condition.target,
      },
      operation,
    );

    if (resolved.status === 'resolved') {
      return {
        status: 'ready',
        condition: {
          ...condition,
          target: {
            kind: 'resolved',
            target: resolved.target,
          },
        },
      };
    }

    if (resolved.error.code === 'TARGET_NOT_FOUND') {
      return {
        status: 'ready',
        condition: {
          ...condition,
          target: {
            kind: 'absent',
            observationId: observation.observation.observationId,
          },
        },
      };
    }

    return {
      status: 'failure',
      error: resolved.error,
    };
  }

  private hasTarget(condition: ConditionSpec): condition is Extract<
    ConditionSpec,
    {
      readonly kind: 'elementVisible' | 'elementAbsent' | 'valueEquals';
      readonly target: TargetSpec;
    }
  > {
    return (
      condition.kind === 'elementVisible' ||
      condition.kind === 'elementAbsent' ||
      condition.kind === 'valueEquals'
    );
  }
}
