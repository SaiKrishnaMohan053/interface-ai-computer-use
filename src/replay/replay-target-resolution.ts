import type { CapabilityStep } from '../artifact/index.js';

import type {
  JsonValue,
  ResolvedTarget,
  SurfaceAdapter,
  SurfaceFailure,
} from '../surface/index.js';

import { TargetResolver } from '../targeting/index.js';

import type { TargetResolutionAttempt, TargetStrategy } from '../targeting/index.js';

export type ReplayTargetResolutionResult =
  | {
      readonly status: 'resolved';
      readonly target: ResolvedTarget;
      readonly attempts: readonly TargetResolutionAttempt[];
    }
  | {
      readonly status: 'failure';
      readonly error: SurfaceFailure;
      readonly attempts: readonly TargetResolutionAttempt[];
    };

export interface ReplayTargetResolutionInput {
  readonly adapter: SurfaceAdapter<TargetStrategy>;
  readonly step: CapabilityStep;
  readonly observationId: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export function replayActionRequiresTarget(step: Pick<CapabilityStep, 'action'>): boolean {
  switch (step.action.kind) {
    case 'click':
    case 'type':
    case 'select':
    case 'check':
    case 'uncheck':
    case 'read':
      return true;

    case 'navigate':
    case 'wait':
    case 'dismiss':
      return false;
  }
}

function invalidTargetFailure(
  message: string,
  expected: JsonValue,
  observed: JsonValue,
): SurfaceFailure {
  return {
    code: 'ACTION_FAILED',
    message,
    expected,
    observed,
  };
}

/**
 * Replay integration boundary for target resolution.
 *
 * The existing TargetResolver remains authoritative for:
 *
 * - ordered strategy fallback,
 * - exactly-one cardinality,
 * - ambiguity handling,
 * - TARGET_NOT_FOUND,
 * - TARGET_AMBIGUOUS.
 *
 * Replay never chooses an element itself.
 */
export async function resolveReplayStepTarget(
  input: ReplayTargetResolutionInput,
): Promise<ReplayTargetResolutionResult> {
  if (!replayActionRequiresTarget(input.step)) {
    return {
      status: 'failure',
      error: invalidTargetFailure(
        `Replay step "${input.step.id}" does not require target resolution.`,
        'target-bearing replay action',
        input.step.action.kind,
      ),
      attempts: [],
    };
  }

  if (input.step.target === undefined) {
    return {
      status: 'failure',
      error: invalidTargetFailure(
        `Replay step "${input.step.id}" is missing its required target.`,
        'TargetSpec',
        'missing',
      ),
      attempts: [],
    };
  }

  const resolver = new TargetResolver(input.adapter);

  const resolved = await resolver.resolve(
    {
      observationId: input.observationId,
      target: input.step.target,
    },
    {
      timeoutMs: input.timeoutMs,

      ...(input.signal === undefined
        ? {}
        : {
            signal: input.signal,
          }),
    },
  );

  if (resolved.status === 'failure') {
    return {
      status: 'failure',
      error: resolved.error,
      attempts: resolved.attempts,
    };
  }

  return {
    status: 'resolved',
    target: resolved.target,
    attempts: resolved.attempts,
  };
}
