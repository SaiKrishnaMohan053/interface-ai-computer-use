import { describe, expect, it, vi } from 'vitest';

import { detectReplayBusinessOutcome } from '../../src/replay/index.js';

import type { CapabilityArtifact, WaitPolicy } from '../../src/artifact/index.js';

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

function artifact(
  knownBusinessOutcomes?: CapabilityArtifact['knownBusinessOutcomes'],
): Pick<CapabilityArtifact, 'knownBusinessOutcomes'> {
  return {
    ...(knownBusinessOutcomes === undefined
      ? {}
      : {
          knownBusinessOutcomes,
        }),
  };
}

function conditionResult(
  input:
    | {
        readonly status: 'passed';
      }
    | {
        readonly status: 'not_met';
        readonly reason: 'mismatch' | 'timeout';
      }
    | {
        readonly status: 'error';
        readonly errorCode:
          | 'TARGET_NOT_FOUND'
          | 'TARGET_AMBIGUOUS'
          | 'STALE_TARGET'
          | 'NAVIGATION_FAILED'
          | 'ACTION_FAILED'
          | 'CONDITION_TIMEOUT'
          | 'CONDITION_EVALUATION_FAILED'
          | 'UNSUPPORTED_OPERATION'
          | 'SURFACE_UNAVAILABLE';
      },
  conditionId: string,
): ConditionResult {
  const base = {
    ...scope,
    conditionId,
    startedAt: '2026-09-20T20:00:00.000Z',
    finishedAt: '2026-09-20T20:00:00.001Z',
    durationMs: 1,
    attempts: 1,
    expected: true,
    observed: input.status === 'passed',
    evidenceRefs: [],
  } as const;

  switch (input.status) {
    case 'passed':
      return {
        ...base,
        status: 'passed',
        passed: true,
      };

    case 'not_met':
      return {
        ...base,
        status: 'not_met',
        passed: false,
        reason: input.reason,
      };

    case 'error':
      return {
        ...base,
        status: 'error',
        passed: false,
        error: {
          code: input.errorCode,
          message: 'Business outcome detector evaluation failed.',
          expected: true,
          observed: false,
        },
      };
  }
}

function adapterWithEvaluate(
  evaluate: SurfaceAdapter<TargetStrategy>['evaluate'],
): SurfaceAdapter<TargetStrategy> {
  return {
    scope,

    observe: vi.fn(() => {
      throw new Error('observe should not be called directly');
    }),

    resolveTarget: vi.fn(() => {
      throw new Error('resolveTarget should not be called directly');
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

const memberNotFound = {
  code: 'MEMBER_NOT_FOUND',
  description: 'No member matched the supplied lookup input.',
  detector: {
    kind: 'textPresent',
    text: 'Member not found',
    match: 'contains',
    caseSensitive: false,
  },
} as const;

const permissionDenied = {
  code: 'PERMISSION_DENIED',
  description: 'The current user cannot access the requested member.',
  detector: {
    kind: 'textPresent',
    text: 'Permission denied',
    match: 'contains',
    caseSensitive: false,
  },
} as const;

describe('replay business outcome detector', () => {
  it('returns none when the artifact declares no business outcomes', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>(() =>
      Promise.reject(new Error('evaluate should not be called')),
    );

    const result = await detectReplayBusinessOutcome({
      adapter: adapterWithEvaluate(evaluate),
      artifact: artifact(),
      wait,
    });

    expect(result).toEqual({
      status: 'none',
      evidenceRefs: [],
    });

    expect(evaluate).not.toHaveBeenCalled();
  });

  it('detects MEMBER_NOT_FOUND as a normal business outcome', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>((request) =>
      Promise.resolve(
        conditionResult(
          {
            status: 'passed',
          },
          request.conditionId,
        ),
      ),
    );

    const result = await detectReplayBusinessOutcome({
      adapter: adapterWithEvaluate(evaluate),
      artifact: artifact([memberNotFound]),
      wait,
    });

    expect(result.status).toBe('detected');

    if (result.status === 'detected') {
      expect(result.outcome.code).toBe('MEMBER_NOT_FOUND');

      expect(result.outcome.message).toBe('No member matched the supplied lookup input.');

      expect(result.outcome.details.detectorIndex).toBe(0);
    }
  });

  it('continues after the first detector is not met and detects the second outcome', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>((request) => {
      if (request.conditionId.startsWith('business-outcome:MEMBER_NOT_FOUND')) {
        return Promise.resolve(
          conditionResult(
            {
              status: 'not_met',
              reason: 'mismatch',
            },
            request.conditionId,
          ),
        );
      }

      return Promise.resolve(
        conditionResult(
          {
            status: 'passed',
          },
          request.conditionId,
        ),
      );
    });

    const result = await detectReplayBusinessOutcome({
      adapter: adapterWithEvaluate(evaluate),

      artifact: artifact([memberNotFound, permissionDenied]),

      wait,
    });

    expect(result.status).toBe('detected');

    if (result.status === 'detected') {
      expect(result.outcome.code).toBe('PERMISSION_DENIED');

      expect(result.outcome.details.detectorIndex).toBe(1);
    }

    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it('returns none when all business outcome detectors are not met', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>((request) =>
      Promise.resolve(
        conditionResult(
          {
            status: 'not_met',
            reason: 'mismatch',
          },
          request.conditionId,
        ),
      ),
    );

    const result = await detectReplayBusinessOutcome({
      adapter: adapterWithEvaluate(evaluate),

      artifact: artifact([memberNotFound, permissionDenied]),

      wait,
    });

    expect(result).toEqual({
      status: 'none',
      evidenceRefs: [],
    });

    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it('returns CHECKPOINT_FAILED when a business outcome detector cannot be evaluated reliably', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>((request) =>
      Promise.resolve(
        conditionResult(
          {
            status: 'error',
            errorCode: 'CONDITION_EVALUATION_FAILED',
          },
          request.conditionId,
        ),
      ),
    );

    const result = await detectReplayBusinessOutcome({
      adapter: adapterWithEvaluate(evaluate),

      artifact: artifact([memberNotFound]),

      wait,
    });

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('CHECKPOINT_FAILED');

      expect(result.error.details.phase).toBe('business_outcome_detection');

      expect(result.error.details.reason).toBe('BUSINESS_OUTCOME_DETECTOR_ERROR');

      expect(result.error.details.underlyingErrorCode).toBe('CONDITION_EVALUATION_FAILED');
    }
  });

  it('fails closed when the artifact declares an unsupported runtime business outcome code', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>(() =>
      Promise.reject(new Error('evaluate should not be called')),
    );

    const unsupportedOutcome = {
      code: 'UNKNOWN_DOMAIN_RESULT',
      description: 'Unsupported business outcome.',
      detector: {
        kind: 'textPresent',
        text: 'Unsupported',
        match: 'contains',
        caseSensitive: false,
      },
    } as const;

    const result = await detectReplayBusinessOutcome({
      adapter: adapterWithEvaluate(evaluate),

      artifact: artifact([unsupportedOutcome]),

      wait,
    });

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('CHECKPOINT_FAILED');

      expect(result.error.details.reason).toBe('UNSUPPORTED_BUSINESS_OUTCOME_CODE');

      expect(result.error.observed).toBe('UNKNOWN_DOMAIN_RESULT');
    }

    expect(evaluate).not.toHaveBeenCalled();
  });

  it('does not throw when a declared business outcome is detected', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>((request) =>
      Promise.resolve(
        conditionResult(
          {
            status: 'passed',
          },
          request.conditionId,
        ),
      ),
    );

    await expect(
      detectReplayBusinessOutcome({
        adapter: adapterWithEvaluate(evaluate),

        artifact: artifact([memberNotFound]),

        wait,
      }),
    ).resolves.toMatchObject({
      status: 'detected',
      outcome: {
        code: 'MEMBER_NOT_FOUND',
      },
    });
  });
});
