import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CapabilityArtifact } from '../../src/artifact/index.js';

import {
  InMemoryInterventionStore,
  InterventionController,
  InterventionManager,
  LiveInterventionRegistry,
} from '../../src/intervention/index.js';

import {
  continueReplayAfterManualStep,
  ReplayOutputStore,
  resolveReplayResume,
} from '../../src/replay/index.js';

import type { ReplayStepExecutor } from '../../src/replay/index.js';

import type { CoordinatedRunContext } from '../../src/runtime/index.js';

import { SessionManager } from '../../src/session/index.js';

import type { SurfaceObservation } from '../../src/surface/index.js';

const artifact: CapabilityArtifact = {
  schemaVersion: '1.0',

  identity: {
    id: 'prepare_new_savings_subaccount',
    name: 'Prepare New Savings Sub-Account',
    version: '1.0.0',
    description: 'Prepare and confirm a new savings sub-account.',
  },

  compatibility: {
    application: 'demo-bank',
    surfaceKind: 'web',
    supportedVersionRange: '1.x',
    vendorFamily: 'demo-core',
  },

  inputs: [],

  outputs: [],

  preconditions: [],

  steps: [
    {
      id: 'prepare-form',
      description: 'Prepare sub-account form.',
      action: {
        kind: 'click',
      },
      risk: 'REVERSIBLE',
    },

    {
      id: 'confirm-create',
      description: 'Confirm Create Sub-Account.',
      action: {
        kind: 'click',
      },
      risk: 'IRREVERSIBLE',
      postconditions: [
        {
          kind: 'textPresent',
          text: 'Sub-account created',
          match: 'contains',
          caseSensitive: false,
        },
      ],
    },

    {
      id: 'verify-created',
      description: 'Verify the created sub-account.',
      action: {
        kind: 'wait',
        condition: {
          kind: 'textPresent',
          text: 'Sub-account created',
          match: 'contains',
          caseSensitive: false,
        },
      },
      risk: 'READ_ONLY',
    },
  ],

  knownBusinessOutcomes: [],

  successCondition: {
    kind: 'all',
    conditions: [
      {
        kind: 'surface',
        condition: {
          kind: 'textPresent',
          text: 'Sub-account created',
          match: 'contains',
          caseSensitive: false,
        },
      },
    ],
  },

  risk: {
    summaryRisk: 'IRREVERSIBLE',
    maxStepRisk: 'IRREVERSIBLE',
    requiresHumanByDefault: true,
    runtimePolicyRequired: true,
  },

  provenance: {
    discoveryRunId: 'discovery-run-resume-integration',
    compiledAt: '2026-09-24T02:40:00.000Z',
    compilerVersion: '1',
    sourceGoal: 'Prepare a new savings sub-account and reach confirmation.',
  },

  metadata: {},
};

describe('human resume into deterministic replay', () => {
  let session: SessionManager | undefined;

  afterEach(async () => {
    await session?.close();
    session = undefined;
  });

  it('re-observes fresh human-resolved state, recognizes the paused postcondition, and continues without duplicating the risky action', async () => {
    session = await SessionManager.create({
      sessionId: 'session-human-resume-replay',
      headed: process.env.HEADED === '1',
    });

    session.activate();
    session.acquireOwnership('REPLAY');

    const replayAccess = session.access('REPLAY');

    await replayAccess.page.setContent(`
      <!doctype html>
      <html>
        <body>
          <main>
            <h1>Review savings sub-account</h1>
            <p id="status">Ready for final confirmation</p>
            <button id="confirm-create" type="button">
              Confirm Create Sub-Account
            </button>
          </main>
        </body>
      </html>
    `);

    const staleObservationId = 'observation-before-human';

    const manager = new InterventionManager({
      store: new InMemoryInterventionStore(),
    });

    const registry = new LiveInterventionRegistry();

    const controller = new InterventionController(manager, registry);

    const context = {
      runId: 'run-human-resume-replay',
      mode: 'REPLAY',
      sessionManager: session,
    } as unknown as CoordinatedRunContext<unknown>;

    const intervention = await controller.createAndPause({
      id: 'intervention-human-resume-replay',
      context,
      source: 'REPLAY',
      capabilityId: artifact.identity.id,
      capabilityVersion: artifact.identity.version,
      stepId: 'confirm-create',
      reasonCode: 'HUMAN_APPROVAL_REQUIRED',
      reason: 'Final account creation is irreversible and requires a human operator.',
      observedState: 'Review screen is ready for final confirmation.',
      evidenceRefs: [],
    });

    expect(intervention.status).toBe('WAITING_FOR_HUMAN');
    expect(session.state).toBe('PAUSED');
    expect(session.owner).toBe('REPLAY');

    await controller.acquireHumanControl({
      interventionId: intervention.id,
      context,
      acquisitionId: 'acquisition-human-resume-replay',
      operatorId: 'operator-test',
    });

    expect(session.state).toBe('PAUSED');
    expect(session.owner).toBe('HUMAN');

    await controller.markHumanWorkInProgress(intervention.id);

    const humanAccess = session.access('HUMAN');

    /*
     * The human performs the risky/manual operation on the SAME live page.
     * This changes the page into the postcondition state replay expects.
     */
    await humanAccess.page.locator('#status').evaluate((element) => {
      element.textContent = 'Sub-account created';
    });

    await humanAccess.page.locator('#confirm-create').evaluate((element) => {
      element.setAttribute('data-human-completed', 'true');
    });

    await controller.recordManualAction({
      interventionId: intervention.id,
      operatorId: 'operator-test',
      summary: 'Human completed the final Create Sub-Account action.',
    });

    const resolvedIntervention = await controller.resumeAutomation({
      interventionId: intervention.id,
      context,
      operatorId: 'operator-test',
    });

    expect(resolvedIntervention.status).toBe('RESOLVED');
    expect(session.state).toBe('ACTIVE');
    expect(session.owner).toBe('REPLAY');

    const observeFresh = vi.fn(async (): Promise<SurfaceObservation> => {
      const access = session!.access('REPLAY');

      return {
        sessionId: session!.sessionId,
        surfaceId: 'surface-human-resume-replay',
        observationId: 'observation-after-human',
        capturedAt: '2026-09-24T02:41:00.000Z',

        location: {
          kind: 'web',
          url: access.page.url(),
          title: await access.page.title(),
        },

        visibleText: (await access.page.locator('body').innerText()).trim(),
        controls: [],
        dialogs: [],
        loading: 'complete',

        truncated: {
          visibleText: false,
          controls: false,
        },
      };
    });

    const evaluatePausedStepPostconditions = vi.fn((observation: SurfaceObservation) => {
      expect(observation.observationId).toBe('observation-after-human');
      expect(observation.observationId).not.toBe(staleObservationId);

      return Promise.resolve(
        observation.visibleText.includes('Sub-account created')
          ? {
              status: 'passed' as const,
            }
          : {
              status: 'not_satisfied' as const,
              reason: 'Creation success text is absent.',
            },
      );
    });

    const resume = await resolveReplayResume({
      step: artifact.steps[1]!,
      stepIndex: 1,
      staleObservationId,
      observeFresh,
      evaluatePausedStepPostconditions,
    });

    expect(observeFresh).toHaveBeenCalledTimes(1);
    expect(evaluatePausedStepPostconditions).toHaveBeenCalledTimes(1);

    expect(resume).toEqual({
      status: 'manual_step_resolved',
      stepId: 'confirm-create',
      resumedFromStepIndex: 1,
      continueAtStepIndex: 2,
      freshObservationId: 'observation-after-human',
    });

    if (resume.status !== 'manual_step_resolved') {
      throw new Error('Expected the human-completed replay step to resolve.');
    }

    /*
     * If replay accidentally tried to re-run the irreversible step,
     * this spy would expose the duplicate.
     */
    const duplicateRiskyAction = vi.fn();

    const execute = vi.fn<ReplayStepExecutor['execute']>((step) => {
      if (step.id === 'confirm-create') {
        duplicateRiskyAction();
      }

      return Promise.resolve({
        status: 'success',
      });
    });

    const continuation = await continueReplayAfterManualStep({
      artifact,
      inputs: {},
      outputStore: new ReplayOutputStore(artifact),

      stepExecutor: {
        execute,
      },

      resume,
    });

    expect(continuation).toEqual({
      status: 'success',
      stepsExecuted: 3,
      outputs: {},
    });

    /*
     * Workflow continued only with the step AFTER the human-completed
     * irreversible action.
     */
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0].id).toBe('verify-created');

    /*
     * Critical 5.39 invariant: no duplicate irreversible action.
     */
    expect(duplicateRiskyAction).not.toHaveBeenCalled();

    expect(
      await session
        .access('REPLAY')
        .page.locator('#confirm-create')
        .getAttribute('data-human-completed'),
    ).toBe('true');
  });
});
