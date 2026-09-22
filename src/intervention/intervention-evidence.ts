import type { EvidenceReference } from '../surface/index.js';
import type { CoordinatedRunContext } from '../runtime/index.js';

import type { InterventionSource } from './intervention-types.js';

export const INTERVENTION_EVIDENCE_CHECKPOINTS = [
  'BEFORE_INTERVENTION',
  'HUMAN_CONTROL',
  'HUMAN_RESOLUTION',
  'AUTOMATION_RESUMED',
] as const;

export type InterventionEvidenceCheckpoint = (typeof INTERVENTION_EVIDENCE_CHECKPOINTS)[number];

export type InterventionScreenshotDataHandling =
  'REDACTED_BEFORE_CAPTURE' | 'SYNTHETIC_FIXTURE_ONLY';

export interface InterventionEvidenceContinuityOptions {
  readonly dataHandling: InterventionScreenshotDataHandling;

  readonly timeoutMs?: number;
}

export interface CaptureInterventionCheckpointInput {
  readonly context: CoordinatedRunContext<unknown>;

  readonly interventionId: string;

  readonly checkpoint: InterventionEvidenceCheckpoint;

  readonly stepId?: string;

  readonly source: InterventionSource;
}

/**
 * Keeps human-handoff evidence inside the original logical run.
 *
 * Persisted correlation is intentionally limited to safe IDs
 * and lifecycle state. No browser handles, cookies, tokens,
 * credentials, form values, or raw human input are written.
 */
export class InterventionEvidenceContinuity {
  private readonly dataHandling: InterventionScreenshotDataHandling;

  private readonly timeoutMs: number;

  constructor(options: InterventionEvidenceContinuityOptions) {
    this.dataHandling = options.dataHandling;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async captureCheckpoint(
    input: CaptureInterventionCheckpointInput,
  ): Promise<EvidenceReference | null> {
    const step = this.evidenceStep(input.stepId);

    try {
      const captured = await input.context.surface.captureEvidence(
        {
          kind: 'screenshot',
          extent: 'viewport',
        },
        {
          timeoutMs: this.timeoutMs,
        },
      );

      if (captured.status !== 'success' || captured.evidence.kind !== 'screenshot') {
        await this.recordContinuityEvent(input, step, false, []);
        return null;
      }

      const reference = await input.context.evidenceRecorder.captureScreenshot({
        step,
        bytes: captured.evidence.bytes,
        capturedAt: captured.evidence.capturedAt,
        dataHandling: this.dataHandling,
      });

      await this.recordContinuityEvent(input, step, true, [reference]);

      return reference;
    } catch {
      /*
       * Evidence is reviewer/debugging support. A screenshot
       * failure must never prevent a safety handoff.
       */
      await this.recordContinuityEvent(input, step, false, []).catch(() => undefined);
      return null;
    }
  }

  private async recordContinuityEvent(
    input: CaptureInterventionCheckpointInput,
    step: number,
    screenshotCaptured: boolean,
    evidenceRefs: readonly EvidenceReference[],
  ): Promise<void> {
    const session = input.context.sessionManager.snapshot();

    await input.context.evidenceRecorder.recordEvent({
      step,
      eventType: 'intervention',
      result: {
        kind: 'handoff_evidence',
        sessionId: session.sessionId,
        interventionId: input.interventionId,
        source: input.source,
        checkpoint: input.checkpoint,
        sessionState: session.state,
        sessionOwner: session.owner,
        screenshotCaptured,
      },
      evidenceRefs,
    });
  }

  private evidenceStep(stepId: string | undefined): number {
    if (stepId === undefined) {
      return 0;
    }

    const parsed = Number(stepId);

    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
  }
}
