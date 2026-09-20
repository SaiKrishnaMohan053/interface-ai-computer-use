import { ConditionEvaluator } from '../conditions/index.js';

import type {
  ArtifactSuccessCondition,
  WaitPolicy,
} from '../artifact/index.js';

import type {
  EvidenceReference,
  JsonValue,
  SurfaceAdapter,
} from '../surface/index.js';

import type { TargetStrategy } from '../targeting/index.js';

import type { ReplayOutputStore } from './output-store.js';

export interface ReplaySuccessConditionFailure {
  readonly code: 'CHECKPOINT_FAILED';
  readonly message: string;
  readonly expected: JsonValue;
  readonly observed: JsonValue;
  readonly details: Readonly<Record<string, JsonValue>>;
}

export type ReplaySuccessConditionResult =
  | {
      readonly status: 'passed';
      readonly evidenceRefs: readonly EvidenceReference[];
    }
  | {
      readonly status: 'failure';
      readonly error: ReplaySuccessConditionFailure;
      readonly evidenceRefs: readonly EvidenceReference[];
    };

interface EvaluateContext {
  readonly adapter: SurfaceAdapter<TargetStrategy>;
  readonly outputStore: ReplayOutputStore;
  readonly wait: WaitPolicy;
  readonly signal?: AbortSignal;
}

interface NodeResult {
  readonly passed: boolean;
  readonly evidenceRefs: readonly EvidenceReference[];
  readonly expected: JsonValue;
  readonly observed: JsonValue;
}

async function evaluateLeaf(
  condition: Extract<
    ArtifactSuccessCondition,
    {
      readonly kind:
        | 'surface'
        | 'outputPresent';
    }
  >,
  context: EvaluateContext,
  path: string,
): Promise<NodeResult> {
  if (condition.kind === 'outputPresent') {
    const present = context.outputStore.has(
      condition.output.name,
    );

    return {
      passed: present,
      evidenceRefs: [],
      expected: true,
      observed: present,
    };
  }

  const evaluator = new ConditionEvaluator(
    context.adapter,
  );

  const result = await evaluator.evaluate(
    {
      conditionId: `success:${path}`,
      condition: condition.condition,
    },
    {
      timeoutMs: context.wait.timeoutMs,
      pollIntervalMs:
        context.wait.pollIntervalMs,
      ...(context.signal === undefined
        ? {}
        : { signal: context.signal }),
    },
  );

  return {
    passed: result.status === 'passed',
    evidenceRefs: result.evidenceRefs,
    expected: result.expected,
    observed: result.observed,
  };
}

async function evaluateNode(
  condition: ArtifactSuccessCondition,
  context: EvaluateContext,
  path: string,
): Promise<NodeResult> {
  switch (condition.kind) {
    case 'surface':
    case 'outputPresent':
      return evaluateLeaf(
        condition,
        context,
        path,
      );

    case 'all': {
      const evidenceRefs: EvidenceReference[] = [];

      for (
        let index = 0;
        index < condition.conditions.length;
        index += 1
      ) {
        const child =
          condition.conditions[index];

        if (child === undefined) {
          return {
            passed: false,
            evidenceRefs,
            expected: true,
            observed: false,
          };
        }

        const result = await evaluateNode(
          child,
          context,
          `${path}.all.${index}`,
        );

        evidenceRefs.push(...result.evidenceRefs);

        if (!result.passed) {
          return {
            passed: false,
            evidenceRefs,
            expected: true,
            observed: false,
          };
        }
      }

      return {
        passed: true,
        evidenceRefs,
        expected: true,
        observed: true,
      };
    }

    case 'any': {
      const evidenceRefs: EvidenceReference[] = [];

      for (
        let index = 0;
        index < condition.conditions.length;
        index += 1
      ) {
        const child =
          condition.conditions[index];

        if (child === undefined) {
          continue;
        }

        const result = await evaluateNode(
          child,
          context,
          `${path}.any.${index}`,
        );

        evidenceRefs.push(...result.evidenceRefs);

        if (result.passed) {
          return {
            passed: true,
            evidenceRefs,
            expected: true,
            observed: true,
          };
        }
      }

      return {
        passed: false,
        evidenceRefs,
        expected: true,
        observed: false,
      };
    }

    case 'not': {
      const result = await evaluateNode(
        condition.condition,
        context,
        `${path}.not`,
      );

      return {
        passed: !result.passed,
        evidenceRefs: result.evidenceRefs,
        expected: true,
        observed: !result.passed,
      };
    }
  }
}

export async function evaluateReplaySuccessCondition(
  input: {
    readonly adapter: SurfaceAdapter<TargetStrategy>;
    readonly condition: ArtifactSuccessCondition;
    readonly outputStore: ReplayOutputStore;
    readonly wait: WaitPolicy;
    readonly signal?: AbortSignal;
  },
): Promise<ReplaySuccessConditionResult> {
  const result = await evaluateNode(
    input.condition,
    {
      adapter: input.adapter,
      outputStore: input.outputStore,
      wait: input.wait,
      ...(input.signal === undefined
        ? {}
        : { signal: input.signal }),
    },
    'root',
  );

  if (!result.passed) {
    return {
      status: 'failure',
      error: {
        code: 'CHECKPOINT_FAILED',
        message:
          'Replay final success condition was not satisfied.',
        expected: true,
        observed: false,
        details: {
          phase: 'success_condition',
          reason:
            'FINAL_SUCCESS_CONDITION_NOT_MET',
        },
      },
      evidenceRefs: result.evidenceRefs,
    };
  }

  return {
    status: 'passed',
    evidenceRefs: result.evidenceRefs,
  };
}