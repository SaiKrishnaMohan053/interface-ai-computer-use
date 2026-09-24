import { describe, expect, it } from 'vitest';

import {
  InMemoryInterventionStore,
  InterventionController,
  InterventionEvidenceContinuity,
  InterventionManager,
  LiveInterventionRegistry,
} from '../../src/intervention/index.js';

import type { EvidenceRecorder } from '../../src/evidence/index.js';
import type { CoordinatedRunContext } from '../../src/runtime/index.js';
import type { SessionManager } from '../../src/session/index.js';
import type {
  EvidenceCaptureRequest,
  EvidenceCaptureResult,
  SurfaceAdapter,
  SurfaceOperationOptions,
} from '../../src/surface/index.js';
import type { TargetStrategy } from '../../src/targeting/index.js';

const NOW = '2026-09-22T22:00:00.000Z';

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

class FakeSessionManager {
  readonly sessionId = 'session-1';

  state: 'ACTIVE' | 'PAUSED' = 'ACTIVE';

  owner: 'REPLAY' | 'HUMAN' | 'NONE' = 'REPLAY';

  pause(requestedBy: 'REPLAY'): void {
    if (this.state !== 'ACTIVE' || this.owner !== requestedBy) {
      throw new Error('Invalid pause');
    }

    this.state = 'PAUSED';
  }

  transferOwnership(from: 'REPLAY' | 'HUMAN', to: 'REPLAY' | 'HUMAN'): void {
    if (this.state !== 'PAUSED' || this.owner !== from) {
      throw new Error('Invalid ownership transfer');
    }

    this.owner = to;
  }

  resume(requestedBy: 'REPLAY'): void {
    if (this.state !== 'PAUSED' || this.owner !== requestedBy) {
      throw new Error('Invalid resume');
    }

    this.state = 'ACTIVE';
  }

  snapshot() {
    return {
      sessionId: this.sessionId,
      state: this.state,
      owner: this.owner,
      failureReason: null,
    } as const;
  }
}

function fixture(options: { readonly failCapture?: boolean } = {}) {
  const store = new InMemoryInterventionStore();

  const manager = new InterventionManager({
    store,
    now: () => NOW,
  });

  const registry = new LiveInterventionRegistry();

  const continuity = new InterventionEvidenceContinuity({
    dataHandling: 'SYNTHETIC_FIXTURE_ONLY',
    timeoutMs: 1_000,
  });

  const controller = new InterventionController(manager, registry, continuity);

  const session = new FakeSessionManager();

  const events: Array<Record<string, unknown>> = [];
  const screenshots: Array<Record<string, unknown>> = [];
  const captureRequests: EvidenceCaptureRequest[] = [];

  let screenshotSequence = 0;

  const evidenceRecorder = {
    recordEvent: (event: Record<string, unknown>) => {
      events.push(event);
      return Promise.resolve();
    },

    captureScreenshot: (input: Record<string, unknown>) => {
      screenshots.push(input);
      screenshotSequence += 1;

      return Promise.resolve({
        evidenceId: `screenshot-${screenshotSequence}`,
        runId: 'run-1',
        kind: 'screenshot' as const,
        relativePath: `run-1/screenshots/screenshot-${String(screenshotSequence).padStart(4, '0')}.png`,
        mediaType: 'image/png',
        capturedAt: NOW,
      });
    },
  } as unknown as EvidenceRecorder;

  const surface = {
    captureEvidence: (
      request: EvidenceCaptureRequest,
      operationOptions: SurfaceOperationOptions,
    ): Promise<EvidenceCaptureResult> => {
      void operationOptions;
      captureRequests.push(request);

      if (options.failCapture === true) {
        return Promise.resolve({
          status: 'failure',
          error: {
            code: 'SURFACE_UNAVAILABLE',
            message: 'Synthetic screenshot unavailable',
            expected: 'screenshot evidence',
            observed: 'capture failed',
          },
        });
      }

      return Promise.resolve({
        status: 'success',
        evidence: {
          sessionId: 'session-1',
          surfaceId: 'surface-1',
          kind: 'screenshot',
          mediaType: 'image/png',
          capturedAt: NOW,
          bytes: PNG_BYTES,
        },
      });
    },
  } as unknown as SurfaceAdapter<TargetStrategy>;

  const context = {
    runId: 'run-1',
    mode: 'REPLAY',
    sessionManager: session as unknown as SessionManager,
    evidenceRecorder,
    policyEngine: {} as CoordinatedRunContext<TargetStrategy>['policyEngine'],
    surface,
  } as CoordinatedRunContext<unknown>;

  return {
    manager,
    controller,
    session,
    events,
    screenshots,
    captureRequests,
    context,
  };
}

async function runCompleteHandoff(
  test: ReturnType<typeof fixture>,
  interventionId: string,
): Promise<void> {
  await test.controller.createAndPause({
    context: test.context,
    id: interventionId,
    source: 'REPLAY',
    capabilityId: 'prepare_new_savings_subaccount',
    capabilityVersion: '1.0.0',
    stepId: '3',
    reasonCode: 'HUMAN_APPROVAL_REQUIRED',
    reason: 'Final create requires human involvement',
    observedState: 'Synthetic sub-account review state',
    evidenceRefs: [],
  });

  await test.controller.acquireHumanControl({
    interventionId,
    context: test.context,
    acquisitionId: `acquisition-${interventionId}`,
    operatorId: 'operator-1',
  });

  await test.controller.recordManualAction({
    interventionId,
    summary: 'Human completed the required synthetic manual step.',
    operatorId: 'operator-1',
  });

  await test.controller.resumeAutomation({
    interventionId,
    context: test.context,
    operatorId: 'operator-1',
  });
}

describe('intervention evidence continuity', () => {
  it('preserves one run/session/intervention chain across pause, human work, and resume', async () => {
    const test = fixture();

    await runCompleteHandoff(test, 'intervention-1');

    const stored = await test.manager.get('intervention-1');

    expect(stored.request).toMatchObject({
      id: 'intervention-1',
      sessionId: 'session-1',
      source: 'REPLAY',
      status: 'RESOLVED',
    });

    expect(test.context.runId).toBe('run-1');
    expect(test.session.sessionId).toBe('session-1');
    expect(test.session.state).toBe('ACTIVE');
    expect(test.session.owner).toBe('REPLAY');

    expect(stored.request.evidenceRefs).toHaveLength(4);

    expect(
      stored.request.evidenceRefs.every(
        (reference) => reference.runId === 'run-1' && reference.kind === 'screenshot',
      ),
    ).toBe(true);

    const continuityEvents = test.events.filter(
      (event) =>
        event.eventType === 'intervention' &&
        (event.result as { kind?: string }).kind === 'handoff_evidence',
    );

    expect(continuityEvents).toHaveLength(4);

    expect(continuityEvents.map((event) => event.result)).toMatchObject([
      {
        sessionId: 'session-1',
        interventionId: 'intervention-1',
        checkpoint: 'BEFORE_INTERVENTION',
        sessionState: 'ACTIVE',
        sessionOwner: 'REPLAY',
      },
      {
        sessionId: 'session-1',
        interventionId: 'intervention-1',
        checkpoint: 'HUMAN_CONTROL',
        sessionState: 'PAUSED',
        sessionOwner: 'HUMAN',
      },
      {
        sessionId: 'session-1',
        interventionId: 'intervention-1',
        checkpoint: 'HUMAN_RESOLUTION',
        sessionState: 'PAUSED',
        sessionOwner: 'HUMAN',
      },
      {
        sessionId: 'session-1',
        interventionId: 'intervention-1',
        checkpoint: 'AUTOMATION_RESUMED',
        sessionState: 'ACTIVE',
        sessionOwner: 'REPLAY',
      },
    ]);
  });

  it('captures only the four intentional handoff screenshots', async () => {
    const test = fixture();

    await runCompleteHandoff(test, 'intervention-2');

    expect(test.captureRequests).toEqual([
      { kind: 'screenshot', extent: 'viewport' },
      { kind: 'screenshot', extent: 'viewport' },
      { kind: 'screenshot', extent: 'viewport' },
      { kind: 'screenshot', extent: 'viewport' },
    ]);

    expect(test.screenshots).toHaveLength(4);

    expect(
      test.screenshots.every((screenshot) => screenshot.dataHandling === 'SYNTHETIC_FIXTURE_ONLY'),
    ).toBe(true);
  });

  it('does not let screenshot failure prevent a safe intervention handoff', async () => {
    const test = fixture({ failCapture: true });

    await expect(
      test.controller.createAndPause({
        context: test.context,
        id: 'intervention-3',
        source: 'REPLAY',
        stepId: '1',
        reasonCode: 'HUMAN_APPROVAL_REQUIRED',
        reason: 'Human involvement required',
        observedState: 'Synthetic state',
        evidenceRefs: [],
      }),
    ).resolves.toMatchObject({
      id: 'intervention-3',
      status: 'WAITING_FOR_HUMAN',
    });

    expect(test.session.state).toBe('PAUSED');

    const continuityEvent = test.events.find(
      (event) =>
        event.eventType === 'intervention' &&
        (event.result as { kind?: string }).kind === 'handoff_evidence',
    );

    expect(continuityEvent?.result).toMatchObject({
      interventionId: 'intervention-3',
      sessionId: 'session-1',
      screenshotCaptured: false,
    });
  });
});
