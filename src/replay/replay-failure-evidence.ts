import type { RuntimeFailureCode } from '../runtime/index.js';

import type {
  EvidenceReference,
  JsonValue,
  SurfaceAdapter,
  SurfaceObservation,
} from '../surface/index.js';

import type { TargetStrategy } from '../targeting/index.js';

import { recordReplayEvidence } from './replay-evidence.js';

import type { ReplayEvidenceSink } from './replay-evidence.js';

export interface ReplayFailureEvidenceInput {
  readonly surface: SurfaceAdapter<TargetStrategy>;

  readonly sink: ReplayEvidenceSink;

  readonly step: number;

  readonly stepId: string | null;

  readonly failure: {
    readonly code: RuntimeFailureCode;

    readonly message: string;

    readonly expected: JsonValue;

    readonly observed: JsonValue;

    readonly details?: Readonly<Record<string, JsonValue>>;
  };

  readonly operationTimeoutMs: number;

  readonly signal?: AbortSignal;
}

export interface ReplayFailureStateSummary {
  readonly observationId: string;

  readonly locationKind: 'web' | 'application';

  readonly url: string | null;

  readonly title: string;

  readonly loading: 'loading' | 'complete' | 'unknown';

  readonly controlCount: number;

  readonly dialogCount: number;

  readonly visibleTextTruncated: boolean;

  readonly controlsTruncated: boolean;
}

export interface ReplayFailureEvidenceResult {
  readonly summary: ReplayFailureStateSummary | null;

  readonly evidenceRefs: readonly EvidenceReference[];

  readonly observationCaptured: boolean;

  readonly screenshotCaptured: boolean;
}

function assertTimeout(timeoutMs: number): void {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Replay failure evidence timeout must be positive and finite');
  }
}

function sanitizeWebUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);

    parsed.search = '';
    parsed.hash = '';

    return parsed.toString();
  } catch {
    return '[invalid-url]';
  }
}

function boundedTitle(value: string): string {
  return value.length <= 500 ? value : value.slice(0, 500);
}

/**
 * Produces a deliberately small state summary.
 *
 * visibleText, input values, dialog text, DOM, controls,
 * cookies, headers, and runtime handles are not persisted.
 */
export function summarizeReplayFailureObservation(
  observation: SurfaceObservation,
): ReplayFailureStateSummary {
  if (observation.location.kind === 'web') {
    return {
      observationId: observation.observationId,

      locationKind: 'web',

      url: sanitizeWebUrl(observation.location.url),

      title: boundedTitle(observation.location.title),

      loading: observation.loading,

      controlCount: observation.controls.length,

      dialogCount: observation.dialogs.length,

      visibleTextTruncated: observation.truncated.visibleText,

      controlsTruncated: observation.truncated.controls,
    };
  }

  return {
    observationId: observation.observationId,

    locationKind: 'application',

    url: null,

    title: boundedTitle(observation.location.windowTitle),

    loading: observation.loading,

    controlCount: observation.controls.length,

    dialogCount: observation.dialogs.length,

    visibleTextTruncated: observation.truncated.visibleText,

    controlsTruncated: observation.truncated.controls,
  };
}

function summaryDetails(summary: ReplayFailureStateSummary): Readonly<Record<string, JsonValue>> {
  return {
    observationId: summary.observationId,

    locationKind: summary.locationKind,

    url: summary.url,

    title: summary.title,

    loading: summary.loading,

    controlCount: summary.controlCount,

    dialogCount: summary.dialogCount,

    visibleTextTruncated: summary.visibleTextTruncated,

    controlsTruncated: summary.controlsTruncated,
  };
}

export async function captureReplayFailureEvidence(
  input: ReplayFailureEvidenceInput,
): Promise<ReplayFailureEvidenceResult> {
  assertTimeout(input.operationTimeoutMs);

  const evidenceRefs: EvidenceReference[] = [];

  const operationOptions = {
    timeoutMs: input.operationTimeoutMs,

    ...(input.signal === undefined
      ? {}
      : {
          signal: input.signal,
        }),
  };

  let summary: ReplayFailureStateSummary | null = null;

  const observationResult = await input.surface.observe({
    ...operationOptions,

    /*
     * Failure evidence does not need to persist page text.
     * Small bounded observation is enough to derive URL/title/
     * loading/count metadata.
     */
    maxTextLength: 1_000,

    maxControls: 100,
  });

  if (observationResult.status === 'success') {
    summary = summarizeReplayFailureObservation(observationResult.observation);
  }

  let screenshotCaptured = false;

  const screenshotResult = await input.surface.captureEvidence(
    {
      kind: 'screenshot',
      extent: 'viewport',
    },
    operationOptions,
  );

  if (screenshotResult.status === 'success') {
    const reference = await input.sink.persistCapturedEvidence(screenshotResult.evidence, {
      step: input.step,

      ...(input.stepId === null
        ? {}
        : {
            stepId: input.stepId,
          }),

      purpose: 'replay-hard-failure',
    });

    evidenceRefs.push(reference);

    screenshotCaptured = true;
  }

  const failureDetails: Record<string, JsonValue> = {
    code: input.failure.code,

    message: input.failure.message,

    stepId: input.stepId,

    expected: input.failure.expected,

    observed: input.failure.observed,

    screenshotCaptured,

    observationCaptured: summary !== null,

    ...(input.failure.details ?? {}),
  };

  if (summary !== null) {
    failureDetails.stateSummary = summaryDetails(summary);
  }

  if (observationResult.status === 'failure') {
    failureDetails.observationCaptureFailure = {
      code: observationResult.error.code,

      message: observationResult.error.message,
    };
  }

  if (screenshotResult.status === 'failure') {
    failureDetails.screenshotCaptureFailure = {
      code: screenshotResult.error.code,

      message: screenshotResult.error.message,
    };
  }

  await recordReplayEvidence({
    sink: input.sink,

    eventType: 'replay.failed',

    step: input.step,

    ...(input.stepId === null
      ? {}
      : {
          stepId: input.stepId,
        }),

    details: failureDetails,

    evidenceRefs,
  });

  return {
    summary,

    evidenceRefs,

    observationCaptured: summary !== null,

    screenshotCaptured,
  };
}
