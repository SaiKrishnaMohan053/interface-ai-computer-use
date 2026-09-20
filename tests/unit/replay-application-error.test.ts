import { describe, expect, it, vi } from 'vitest';

import { detectReplayApplicationError } from '../../src/replay/index.js';

import type {
  ConditionResult,
  EvidenceReference,
  SurfaceAdapter,
} from '../../src/surface/index.js';

import type { TargetStrategy } from '../../src/targeting/index.js';

const scope = {
  sessionId: 'replay-session',
  surfaceId: 'replay-surface',
} as const;

const wait = {
  timeoutMs: 1_000,
  pollIntervalMs: 100,
} as const;

function passed(): ConditionResult {
  return {
    ...scope,

    conditionId: 'runtime-state:application-error:step-1',

    startedAt: '2026-09-20T21:00:00.000Z',

    finishedAt: '2026-09-20T21:00:00.001Z',

    durationMs: 1,
    attempts: 1,

    expected: true,
    observed: 'Application error',

    evidenceRefs: [],

    status: 'passed',
    passed: true,
  };
}

function notMet(): ConditionResult {
  return {
    ...scope,

    conditionId: 'runtime-state:application-error:step-1',

    startedAt: '2026-09-20T21:00:00.000Z',

    finishedAt: '2026-09-20T21:00:00.001Z',

    durationMs: 1,
    attempts: 1,

    expected: true,
    observed: false,

    evidenceRefs: [],

    status: 'not_met',
    passed: false,
    reason: 'mismatch',
  };
}

function errorResult(): ConditionResult {
  return {
    ...scope,

    conditionId: 'runtime-state:application-error:step-1',

    startedAt: '2026-09-20T21:00:00.000Z',

    finishedAt: '2026-09-20T21:00:00.001Z',

    durationMs: 1,
    attempts: 1,

    expected: true,
    observed: null,

    evidenceRefs: [],

    status: 'error',
    passed: false,

    error: {
      code: 'CONDITION_EVALUATION_FAILED',

      message: 'Could not evaluate application state.',

      expected: true,
      observed: null,
    },
  };
}

function adapter(
  evaluate: SurfaceAdapter<TargetStrategy>['evaluate'],
): SurfaceAdapter<TargetStrategy> {
  return {
    scope,

    observe: vi.fn(() => Promise.reject(new Error('observe should not be called'))),

    resolveTarget: vi.fn(() => Promise.reject(new Error('resolveTarget should not be called'))),

    perform: vi.fn(() => Promise.reject(new Error('perform should not be called'))),

    evaluate,

    captureEvidence: vi.fn(() =>
      Promise.reject(new Error('adapter captureEvidence is not used directly')),
    ),
  };
}

function evidenceRef(): EvidenceReference {
  return {
    evidenceId: 'evidence-application-error',

    runId: 'run-1',

    kind: 'screenshot',

    relativePath: 'screenshots/application-error.png',

    mediaType: 'image/png',

    capturedAt: '2026-09-20T21:00:00.002Z',
  };
}

describe('replay application error detector', () => {
  it('returns APPLICATION_ERROR when the application error state is detected', async () => {
    const evaluate = vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>(() =>
      Promise.resolve(passed()),
    );

    const captureEvidence = vi.fn(() => Promise.resolve([evidenceRef()]));

    const result = await detectReplayApplicationError({
      adapter: adapter(evaluate),

      stepId: 'step-1',

      wait,

      captureEvidence,
    });

    expect(result.signal.kind).toBe('failure');

    if (result.signal.kind === 'failure') {
      expect(result.signal.code).toBe('APPLICATION_ERROR');
    }
  });

  it('includes the step ID and observed state in the failure details', async () => {
    const result = await detectReplayApplicationError({
      adapter: adapter(
        vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>(() => Promise.resolve(passed())),
      ),

      stepId: 'step-1',

      wait,

      captureEvidence: () => Promise.resolve([evidenceRef()]),
    });

    if (result.signal.kind !== 'failure') {
      throw new Error('Expected failure signal');
    }

    expect(result.signal.details?.stepId).toBe('step-1');

    expect(result.signal.details?.observedState).toBe('Application error');
  });

  it('captures evidence when an application error is detected', async () => {
    const captureEvidence = vi.fn(() => Promise.resolve([evidenceRef()]));

    const result = await detectReplayApplicationError({
      adapter: adapter(
        vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>(() => Promise.resolve(passed())),
      ),

      stepId: 'step-1',

      wait,

      captureEvidence,
    });

    expect(captureEvidence).toHaveBeenCalledTimes(1);

    expect(result.evidenceRefs).toEqual([evidenceRef()]);
  });

  it('does not capture application-error evidence when the state is absent', async () => {
    const captureEvidence = vi.fn(() => Promise.resolve([evidenceRef()]));

    const result = await detectReplayApplicationError({
      adapter: adapter(
        vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>(() => Promise.resolve(notMet())),
      ),

      stepId: 'step-1',

      wait,

      captureEvidence,
    });

    expect(result.signal).toEqual({
      kind: 'none',
    });

    expect(captureEvidence).not.toHaveBeenCalled();
  });

  it('fails closed when application-error detection itself cannot be evaluated reliably', async () => {
    const captureEvidence = vi.fn(() => Promise.resolve([evidenceRef()]));

    const result = await detectReplayApplicationError({
      adapter: adapter(
        vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>(() => Promise.resolve(errorResult())),
      ),

      stepId: 'step-1',

      wait,

      captureEvidence,
    });

    expect(result.signal.kind).toBe('failure');

    if (result.signal.kind === 'failure') {
      expect(result.signal.code).toBe('CHECKPOINT_FAILED');
    }

    expect(captureEvidence).not.toHaveBeenCalled();
  });

  it('does not attempt recovery automatically after APPLICATION_ERROR', async () => {
    const result = await detectReplayApplicationError({
      adapter: adapter(
        vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>(() => Promise.resolve(passed())),
      ),

      stepId: 'step-1',

      wait,

      captureEvidence: () => Promise.resolve([evidenceRef()]),
    });

    if (result.signal.kind !== 'failure') {
      throw new Error('Expected application failure');
    }

    expect(result.signal.details?.recoveryDeclared).toBe(false);
  });
});
