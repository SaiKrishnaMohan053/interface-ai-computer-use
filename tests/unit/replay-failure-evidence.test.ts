import { describe, expect, it, vi } from 'vitest';

import {
  captureReplayFailureEvidence,
  summarizeReplayFailureObservation,
} from '../../src/replay/index.js';

import type { ReplayEvidenceEvent, ReplayEvidenceSink } from '../../src/replay/index.js';

import type {
  EvidenceCaptureResult,
  EvidenceReference,
  ObservationResult,
  SurfaceAdapter,
  SurfaceObservation,
} from '../../src/surface/index.js';

import type { TargetStrategy } from '../../src/targeting/index.js';

const scope = {
  sessionId: 'replay-session',
  surfaceId: 'replay-surface',
} as const;

function observation(): SurfaceObservation {
  return {
    ...scope,

    observationId: 'obs-4',

    capturedAt: '2026-09-20T21:00:00.000Z',

    location: {
      kind: 'web',

      url: 'https://bank.test/accounts?token=secret#fragment',

      title: 'Accounts - Demo Bank',
    },

    visibleText: 'Sensitive page content that must not appear in the persisted summary.',

    controls: [
      {
        controlId: 'control-1',
        name: 'Retry',
        role: 'button',
        visible: true,
        enabled: true,
        bounds: null,
        kind: 'button',
      },
    ],

    dialogs: [],

    loading: 'complete',

    truncated: {
      visibleText: false,
      controls: false,
    },
  };
}

function screenshotReference(): EvidenceReference {
  return {
    evidenceId: 'evidence-failure-1',

    runId: 'run-1',

    kind: 'screenshot',

    relativePath: 'screenshots/failure.png',

    mediaType: 'image/png',

    capturedAt: '2026-09-20T21:00:01.000Z',
  };
}

function evidenceSink(): ReplayEvidenceSink & {
  readonly recordEvent: ReturnType<typeof vi.fn<(event: ReplayEvidenceEvent) => Promise<void>>>;

  readonly persistCapturedEvidence: ReturnType<
    typeof vi.fn<ReplayEvidenceSink['persistCapturedEvidence']>
  >;
} {
  const recordEvent = vi.fn<(event: ReplayEvidenceEvent) => Promise<void>>(() => Promise.resolve());

  const persistCapturedEvidence = vi.fn<ReplayEvidenceSink['persistCapturedEvidence']>(() =>
    Promise.resolve(screenshotReference()),
  );

  return {
    recordEvent,
    persistCapturedEvidence,
  };
}

interface SurfaceOptions {
  readonly observeResult?: ObservationResult;

  readonly evidenceResult?: EvidenceCaptureResult;
}

function surface(options: SurfaceOptions = {}): SurfaceAdapter<TargetStrategy> {
  const observeResult: ObservationResult = options.observeResult ?? {
    status: 'success',
    observation: observation(),
  };

  const evidenceResult: EvidenceCaptureResult = options.evidenceResult ?? {
    status: 'success',

    evidence: {
      ...scope,

      kind: 'screenshot',

      mediaType: 'image/png',

      capturedAt: '2026-09-20T21:00:01.000Z',

      bytes: new Uint8Array([1, 2, 3]),
    },
  };

  return {
    scope,

    observe: vi.fn<SurfaceAdapter<TargetStrategy>['observe']>(() => Promise.resolve(observeResult)),

    resolveTarget: vi.fn<SurfaceAdapter<TargetStrategy>['resolveTarget']>(() =>
      Promise.reject(new Error('not used')),
    ),

    perform: vi.fn<SurfaceAdapter<TargetStrategy>['perform']>(() =>
      Promise.reject(new Error('not used')),
    ),

    evaluate: vi.fn<SurfaceAdapter<TargetStrategy>['evaluate']>(() =>
      Promise.reject(new Error('not used')),
    ),

    captureEvidence: vi.fn<SurfaceAdapter<TargetStrategy>['captureEvidence']>(() =>
      Promise.resolve(evidenceResult),
    ),
  };
}

describe('replay failure evidence', () => {
  it('creates a sanitized state summary without visible page text', () => {
    const summary = summarizeReplayFailureObservation(observation());

    expect(summary).toEqual({
      observationId: 'obs-4',

      locationKind: 'web',

      url: 'https://bank.test/accounts',

      title: 'Accounts - Demo Bank',

      loading: 'complete',

      controlCount: 1,

      dialogCount: 0,

      visibleTextTruncated: false,

      controlsTruncated: false,
    });

    expect('visibleText' in summary).toBe(false);

    expect(JSON.stringify(summary)).not.toContain('Sensitive page content');

    expect(summary.url).not.toContain('token=secret');
  });

  it('captures screenshot evidence through the persistence boundary', async () => {
    const sink = evidenceSink();

    const result = await captureReplayFailureEvidence({
      surface: surface(),

      sink,

      step: 4,

      stepId: 'read-savings-balance',

      failure: {
        code: 'ACTION_FAILED',

        message: 'Read failed.',

        expected: 'currency value',

        observed: null,
      },

      operationTimeoutMs: 2_000,
    });

    expect(sink.persistCapturedEvidence).toHaveBeenCalledTimes(1);

    expect(result.evidenceRefs).toEqual([screenshotReference()]);

    expect(result.screenshotCaptured).toBe(true);
  });

  it('records a structured replay.failed event with the persisted screenshot reference', async () => {
    const sink = evidenceSink();

    await captureReplayFailureEvidence({
      surface: surface(),

      sink,

      step: 4,

      stepId: 'read-savings-balance',

      failure: {
        code: 'ACTION_FAILED',

        message: 'Read failed.',

        expected: 'currency value',

        observed: null,
      },

      operationTimeoutMs: 2_000,
    });

    expect(sink.recordEvent).toHaveBeenCalledTimes(1);

    expect(sink.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'replay.failed',

        step: 4,

        stepId: 'read-savings-balance',

        evidenceRefs: [screenshotReference()],
      }),
    );
  });

  it('includes step ID, expected, observed, URL, title, and state metadata', async () => {
    const sink = evidenceSink();

    await captureReplayFailureEvidence({
      surface: surface(),

      sink,

      step: 4,

      stepId: 'read-savings-balance',

      failure: {
        code: 'TARGET_NOT_FOUND',

        message: 'Balance cell not found.',

        expected: 'exactly-one',

        observed: 0,
      },

      operationTimeoutMs: 2_000,
    });

    const call = sink.recordEvent.mock.calls[0]?.[0];

    expect(call).toBeDefined();

    if (call === undefined) {
      return;
    }

    expect(call.details.stepId).toBe('read-savings-balance');

    expect(call.details.expected).toBe('exactly-one');

    expect(call.details.observed).toBe(0);

    expect(call.details.stateSummary).toEqual({
      observationId: 'obs-4',

      locationKind: 'web',

      url: 'https://bank.test/accounts',

      title: 'Accounts - Demo Bank',

      loading: 'complete',

      controlCount: 1,

      dialogCount: 0,

      visibleTextTruncated: false,

      controlsTruncated: false,
    });
  });

  it('does not embed raw screenshot bytes into the replay failure event', async () => {
    const sink = evidenceSink();

    await captureReplayFailureEvidence({
      surface: surface(),

      sink,

      step: 1,

      stepId: 'step-1',

      failure: {
        code: 'ACTION_FAILED',

        message: 'failed',

        expected: null,

        observed: null,
      },

      operationTimeoutMs: 1_000,
    });

    const call = sink.recordEvent.mock.calls[0]?.[0];

    expect(call).toBeDefined();

    if (call === undefined) {
      return;
    }

    expect(JSON.stringify(call)).not.toContain('"bytes"');
  });

  it('still records structured failure evidence when screenshot capture fails', async () => {
    const replaySurface = surface({
      evidenceResult: {
        status: 'failure',

        error: {
          code: 'SURFACE_UNAVAILABLE',

          message: 'Screenshot unavailable.',

          expected: 'available surface',

          observed: 'blocked surface',
        },
      },
    });

    const sink = evidenceSink();

    const result = await captureReplayFailureEvidence({
      surface: replaySurface,

      sink,

      step: 2,

      stepId: 'step-2',

      failure: {
        code: 'APPLICATION_ERROR',

        message: 'Application error.',

        expected: 'healthy app',

        observed: 'error state',
      },

      operationTimeoutMs: 1_000,
    });

    expect(result.screenshotCaptured).toBe(false);

    expect(sink.recordEvent).toHaveBeenCalledTimes(1);

    expect(sink.persistCapturedEvidence).not.toHaveBeenCalled();
  });

  it('still captures screenshot and records failure when observation capture fails', async () => {
    const replaySurface = surface({
      observeResult: {
        status: 'failure',

        error: {
          code: 'SURFACE_UNAVAILABLE',

          message: 'Observation unavailable.',

          expected: 'observable surface',

          observed: 'unavailable',
        },
      },
    });

    const sink = evidenceSink();

    const result = await captureReplayFailureEvidence({
      surface: replaySurface,

      sink,

      step: 3,

      stepId: 'step-3',

      failure: {
        code: 'NAVIGATION_FAILED',

        message: 'Navigation failed.',

        expected: '/accounts',

        observed: '/members',
      },

      operationTimeoutMs: 1_000,
    });

    expect(result.observationCaptured).toBe(false);

    expect(result.screenshotCaptured).toBe(true);

    expect(sink.recordEvent).toHaveBeenCalledTimes(1);
  });

  it('uses bounded surface operations', async () => {
    const replaySurface = surface();

    const observeSpy = vi.spyOn(replaySurface, 'observe');

    const captureSpy = vi.spyOn(replaySurface, 'captureEvidence');

    await captureReplayFailureEvidence({
      surface: replaySurface,

      sink: evidenceSink(),

      step: 1,

      stepId: 'step-1',

      failure: {
        code: 'ACTION_FAILED',

        message: 'failed',

        expected: null,

        observed: null,
      },

      operationTimeoutMs: 3_000,
    });

    expect(observeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        timeoutMs: 3_000,
        maxTextLength: 1_000,
        maxControls: 100,
      }),
    );

    expect(captureSpy).toHaveBeenCalledWith(
      {
        kind: 'screenshot',
        extent: 'viewport',
      },

      expect.objectContaining({
        timeoutMs: 3_000,
      }),
    );
  });

  it('rejects invalid evidence timeout configuration', async () => {
    await expect(
      captureReplayFailureEvidence({
        surface: surface(),

        sink: evidenceSink(),

        step: 1,

        stepId: 'step-1',

        failure: {
          code: 'ACTION_FAILED',

          message: 'failed',

          expected: null,

          observed: null,
        },

        operationTimeoutMs: 0,
      }),
    ).rejects.toThrow('Replay failure evidence timeout must be positive and finite');
  });
});
