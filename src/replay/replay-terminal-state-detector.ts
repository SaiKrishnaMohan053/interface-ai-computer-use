import { ConditionEvaluator } from '../conditions/index.js';

import type { WaitPolicy } from '../artifact/index.js';

import type { EvidenceReference, SurfaceAdapter } from '../surface/index.js';

import type { TargetStrategy } from '../targeting/index.js';

import type { ReplayRuntimeSignal } from './replay-runtime-classifier.js';

const SESSION_EXPIRED_CONDITION = {
  kind: 'textPresent',
  text: 'Session expired',
  match: 'contains',
  caseSensitive: false,
} as const;

const PERMISSION_DENIED_CONDITION = {
  kind: 'textPresent',
  text: 'Permission denied',
  match: 'contains',
  caseSensitive: false,
} as const;

export interface ReplayTerminalStateDetectionInput {
  readonly adapter: SurfaceAdapter<TargetStrategy>;

  readonly wait: WaitPolicy;

  readonly signal?: AbortSignal;
}

export interface ReplayTerminalStateDetectionResult {
  readonly signal: ReplayRuntimeSignal;

  readonly evidenceRefs: readonly EvidenceReference[];
}

function detectorFailure(
  detector: 'SESSION_EXPIRED' | 'PERMISSION_DENIED',
  underlyingErrorCode: string,
): ReplayRuntimeSignal {
  return {
    kind: 'failure',

    code: 'CHECKPOINT_FAILED',

    message: `Replay could not reliably evaluate terminal runtime state "${detector}".`,

    expected: 'reliable terminal-state evaluation',

    observed: 'condition evaluation error',

    details: {
      phase: 'runtime_state_detection',

      detector,

      underlyingErrorCode,
    },
  };
}

/**
 * Detects global runtime states that must be
 * handled before blindly continuing replay.
 *
 * Ordering is deliberate:
 *
 * 1. SESSION_EXPIRED
 * 2. PERMISSION_DENIED
 *
 * Session expiration is an operational terminal
 * failure and takes precedence over a domain
 * permission outcome if both signals somehow
 * appear on the same surface.
 */
export async function detectReplayTerminalState(
  input: ReplayTerminalStateDetectionInput,
): Promise<ReplayTerminalStateDetectionResult> {
  const evaluator = new ConditionEvaluator(input.adapter);

  const evidenceRefs: EvidenceReference[] = [];

  const evaluationOptions = {
    timeoutMs: input.wait.timeoutMs,

    pollIntervalMs: input.wait.pollIntervalMs,

    ...(input.signal === undefined
      ? {}
      : {
          signal: input.signal,
        }),
  };

  const sessionExpired = await evaluator.evaluate(
    {
      conditionId: 'runtime-state:session-expired',

      condition: SESSION_EXPIRED_CONDITION,
    },
    evaluationOptions,
  );

  evidenceRefs.push(...sessionExpired.evidenceRefs);

  if (sessionExpired.status === 'passed') {
    return {
      signal: {
        kind: 'failure',

        code: 'SESSION_EXPIRED_UNRECOVERABLE',

        message:
          'The replay session expired and no deterministic reauthentication recovery is declared.',

        expected: 'active authenticated session',

        observed: 'session expired',

        details: {
          phase: 'runtime_state_detection',

          condition: 'SESSION_EXPIRED',

          recoveryDeclared: false,
        },
      },

      evidenceRefs,
    };
  }

  if (sessionExpired.status === 'error') {
    return {
      signal: detectorFailure('SESSION_EXPIRED', sessionExpired.error.code),

      evidenceRefs,
    };
  }

  const permissionDenied = await evaluator.evaluate(
    {
      conditionId: 'runtime-state:permission-denied',

      condition: PERMISSION_DENIED_CONDITION,
    },
    evaluationOptions,
  );

  evidenceRefs.push(...permissionDenied.evidenceRefs);

  if (permissionDenied.status === 'passed') {
    return {
      signal: {
        kind: 'business_outcome',

        outcome: {
          code: 'PERMISSION_DENIED',

          message: 'The current user does not have permission to access the requested resource.',

          details: {
            phase: 'runtime_state_detection',

            condition: 'PERMISSION_DENIED',
          },
        },
      },

      evidenceRefs,
    };
  }

  if (permissionDenied.status === 'error') {
    return {
      signal: detectorFailure('PERMISSION_DENIED', permissionDenied.error.code),

      evidenceRefs,
    };
  }

  return {
    signal: {
      kind: 'none',
    },

    evidenceRefs,
  };
}
