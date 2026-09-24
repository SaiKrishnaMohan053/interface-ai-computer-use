import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { resolve } from 'node:path';

import { createDemoServer } from '../../demo-app/server.js';

import type { CapabilityStep } from '../artifact/index.js';

import {
  FileSystemInterventionStore,
  InterventionController,
  InterventionEvidenceContinuity,
  InterventionManager,
  LiveInterventionRegistry,
  OperatorControlServer,
  finalizeHumanAbort,
} from '../intervention/index.js';

import { PolicyEngine } from '../policy/index.js';

import { evaluateReplayPolicy, resolveReplayResume } from '../replay/index.js';

import { RunCoordinator } from '../runtime/index.js';

import { PlaywrightSurface } from '../surface/playwright/index.js';

import type { PlaywrightStrategy } from '../surface/playwright/index.js';

const MEMBER_ID = '12345';
const CAPABILITY_ID = 'prepare_new_savings_subaccount';
const CAPABILITY_VERSION = '1.0.0';
const NICKNAME = 'Human Handoff Savings';
const EVIDENCE_ROOT = resolve('evidence');

function createPolicy(origin: string): PolicyEngine {
  return new PolicyEngine({
    policyId: 'hitl-demo-policy',
    version: 1,
    defaultDecision: 'DENY',

    allowedOrigins: [origin],

    allowedRoutes: [
      {
        routeId: 'subaccount-commit',
        description: 'Synthetic sub-account commit route',
        match: {
          kind: 'exact',
          pathname: `/member/${MEMBER_ID}/subaccounts/commit`,
        },
      },
      {
        routeId: 'member-pages',
        description: 'Synthetic member servicing routes',
        match: {
          kind: 'prefix',
          pathname: '/member/',
        },
      },
    ],

    allowedActions: ['navigate', 'type', 'select', 'click', 'read', 'wait'],

    riskRules: [
      {
        ruleId: 'irreversible-subaccount-commit',
        description: 'Committing a sub-account requires human approval',
        match: {
          actions: ['click'],
          routeIds: ['subaccount-commit'],
        },
        riskLevel: 'IRREVERSIBLE',
        decision: 'REQUIRE_HUMAN',
      },
      {
        ruleId: 'read-only-actions',
        description: 'Read-only actions may run automatically',
        match: {
          actions: ['read', 'wait'],
        },
        riskLevel: 'READ_ONLY',
        decision: 'ALLOW',
      },
      {
        ruleId: 'reversible-member-actions',
        description: 'Reversible member navigation and input are allowed',
        match: {
          actions: ['navigate', 'type', 'select', 'click'],
          routeIds: ['member-pages'],
        },
        riskLevel: 'REVERSIBLE',
        decision: 'ALLOW',
      },
    ],
  });
}

function confirmCreateStep(): CapabilityStep {
  return {
    id: 'confirm-create',
    description: 'Confirm Create Sub-Account',

    action: {
      kind: 'click',
    },

    risk: 'IRREVERSIBLE',

    target: {
      description: 'Confirm Create Sub-Account button',

      strategies: [
        {
          kind: 'role-name',
          role: 'button',
          name: {
            value: 'Confirm Create Sub-Account',
            mode: 'exact',
            caseSensitive: false,
          },
        },
      ],

      cardinality: 'exactly-one',
    },

    postconditions: [
      {
        kind: 'textPresent',
        text: 'Sub-account created',
        match: 'contains',
        caseSensitive: false,
      },
    ],
  };
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolveClose();
        return;
      }

      reject(error);
    });
  });
}

async function startDemoServer(): Promise<{
  readonly server: Server;
  readonly origin: string;
}> {
  const server = createDemoServer();

  server.listen(0, '127.0.0.1');

  await once(server, 'listening');

  const address = server.address();

  if (address === null || typeof address === 'string') {
    await closeServer(server);
    throw new Error('Demo server did not expose a TCP port');
  }

  return {
    server,
    origin: `http://127.0.0.1:${address.port}`,
  };
}

async function waitForHumanDecision(
  manager: InterventionManager,
  interventionId: string,
): Promise<'RESOLVED' | 'ABORTED'> {
  for (;;) {
    const stored = await manager.get(interventionId);

    if (stored.request.status === 'RESOLVED' || stored.request.status === 'ABORTED') {
      return stored.request.status;
    }

    await new Promise<void>((resolveWait) => {
      setTimeout(resolveWait, 250);
    });
  }
}

async function main(): Promise<void> {
  const runId = `hitl-demo-${randomUUID()}`;
  const interventionId = `hitl-${randomUUID()}`;

  const demo = await startDemoServer();

  const policyEngine = createPolicy(demo.origin);

  const coordinator = new RunCoordinator<PlaywrightStrategy>({
    policyEngine,

    createSurface: ({ access, surfaceId }) =>
      new PlaywrightSurface(access.page, {
        sessionId: access.sessionId,
        surfaceId,
      }),
  });

  const interventionStore = new FileSystemInterventionStore();

  const manager = new InterventionManager({
    store: interventionStore,
  });

  const registry = new LiveInterventionRegistry();

  let operatorServer: OperatorControlServer | undefined;
  let finalized = false;

  try {
    const context = await coordinator.start({
      runId,
      mode: 'REPLAY',
      evidenceRoot: EVIDENCE_ROOT,
      headed: true,
      timeoutMs: 15_000,

      metadata: {
        demo: 'real-human-handoff',
        capabilityId: CAPABILITY_ID,
        capabilityVersion: CAPABILITY_VERSION,
        dataHandling: 'SYNTHETIC_FIXTURE_ONLY',
      },
    });

    const evidenceContinuity = new InterventionEvidenceContinuity({
      dataHandling: 'SYNTHETIC_FIXTURE_ONLY',
      timeoutMs: 5_000,
    });

    const controller = new InterventionController(manager, registry, evidenceContinuity);

    operatorServer = new OperatorControlServer({
      manager,
      controller,
      liveRegistry: registry,
    });

    const operatorAddress = await operatorServer.start();

    const automatedPage = () => context.sessionManager.access('REPLAY').page;

    const recordAllowedAction = async (
      step: number,
      url: string,
      actionKind: 'navigate' | 'type' | 'select' | 'click',
      execute: () => Promise<void>,
    ): Promise<void> => {
      const decision = context.policyEngine.evaluate({
        url,
        action: {
          kind: actionKind,
        },
      });

      await context.evidenceRecorder.recordEvent({
        step,
        eventType: 'policy_decision',
        action: {
          kind: actionKind,
        },
        policyDecision: decision,
      });

      if (decision.decision !== 'ALLOW') {
        throw new Error(
          `Safe demo action "${actionKind}" was not policy-allowed: ${decision.reason}`,
        );
      }

      /*
       * Final ownership assertion immediately before browser execution.
       */
      context.sessionManager.access('REPLAY');

      await execute();

      await context.evidenceRecorder.recordEvent({
        step,
        eventType: 'action',
        action: {
          kind: actionKind,
        },
        result: {
          status: 'success',
        },
      });
    };

    const formUrl = `${demo.origin}/member/${MEMBER_ID}/subaccounts/new`;

    await recordAllowedAction(1, formUrl, 'navigate', async () => {
      await automatedPage().goto(formUrl, {
        waitUntil: 'domcontentloaded',
      });
    });

    await recordAllowedAction(2, formUrl, 'select', async () => {
      await automatedPage().locator('#parent-account').selectOption({
        index: 1,
      });
    });

    await recordAllowedAction(3, formUrl, 'type', async () => {
      await automatedPage().locator('#subaccount-name').fill(NICKNAME);
    });

    await recordAllowedAction(4, formUrl, 'click', async () => {
      await Promise.all([
        automatedPage().waitForLoadState('domcontentloaded'),
        automatedPage().getByRole('button', { name: 'Review Sub-account' }).click(),
      ]);
    });

    const staleObserved = await context.surface.observe({
      timeoutMs: 5_000,
      maxTextLength: 8_000,
      maxControls: 100,
    });

    if (staleObserved.status !== 'success') {
      throw new Error(`Could not observe review state: ${staleObserved.error.message}`);
    }

    const commitUrl = `${demo.origin}/member/${MEMBER_ID}/subaccounts/commit`;

    const confirmStep = confirmCreateStep();

    const gate = evaluateReplayPolicy({
      step: confirmStep,
      url: commitUrl,
      policyEngine: context.policyEngine,
    });

    await context.evidenceRecorder.recordEvent({
      step: 5,
      eventType: 'policy_decision',
      action: confirmStep.action,
      target: confirmStep.target ?? null,
      policyDecision:
        gate.status === 'intervention_required'
          ? {
              decision: 'REQUIRE_HUMAN',
              code: gate.intervention.code,
              riskLevel: gate.intervention.details.effectiveRisk,
              matchedRuleId: gate.intervention.details.matchedRuleId,
            }
          : {
              decision: gate.status,
            },
    });

    if (gate.status !== 'intervention_required') {
      throw new Error(
        `Expected irreversible commit to require human intervention; received ${gate.status}`,
      );
    }

    /*
     * Capture reviewer/operator display information while REPLAY is still ACTIVE.
     * After createAndPause(), SessionManager.access('REPLAY') must fail by design.
     */
    const browserUrlAtHandoff = automatedPage().url();

    const intervention = await controller.createAndPause({
      id: interventionId,
      context,
      source: 'REPLAY',
      capabilityId: CAPABILITY_ID,
      capabilityVersion: CAPABILITY_VERSION,
      stepId: confirmStep.id,
      reasonCode: 'HUMAN_APPROVAL_REQUIRED',
      reason: 'Confirm Create Sub-Account is irreversible and requires a human operator.',
      observedState:
        'Synthetic sub-account review screen is open with the final confirmation button visible.',
      evidenceRefs: [],
    });

    process.stdout.write('\n=== REAL HITL DEMO PAUSED ===\n');
    process.stdout.write(`Run ID: ${runId}\n`);
    process.stdout.write(`Intervention ID: ${intervention.id}\n`);
    process.stdout.write(`Session ID: ${context.sessionManager.sessionId}\n`);
    process.stdout.write(`Operator server: ${operatorAddress.baseUrl}\n`);
    process.stdout.write(`Browser URL: ${browserUrlAtHandoff}\n\n`);

    process.stdout.write('Open a SECOND PowerShell terminal in this repository.\n\n');
    process.stdout.write('Run:\n');
    process.stdout.write(`  npm run intervention:acquire -- ${intervention.id}\n`);
    process.stdout.write(`  npm run intervention:start -- ${intervention.id}\n\n`);
    process.stdout.write(
      'Then manually click "Confirm Create Sub-Account" in the ALREADY-OPEN headed browser.\n\n',
    );
    process.stdout.write('After the browser shows "Sub-account created", run:\n');
    process.stdout.write(
      `  npm run intervention:manual-action -- ${intervention.id} Human completed final synthetic sub-account action\n`,
    );
    process.stdout.write(`  npm run intervention:resume -- ${intervention.id}\n\n`);
    process.stdout.write('Terminal 1 is waiting for the operator decision...\n');

    const decision = await waitForHumanDecision(manager, intervention.id);

    if (decision === 'ABORTED') {
      const terminal = await finalizeHumanAbort({
        interventionId: intervention.id,
        context,
        manager,
        coordinator,
        liveRegistry: registry,
      });

      finalized = true;

      process.stdout.write('\nHITL demo aborted by the human operator.\n');
      process.stdout.write(`${JSON.stringify(terminal, null, 2)}\n`);
      return;
    }

    const resume = await resolveReplayResume({
      step: confirmStep,
      stepIndex: 4,
      staleObservationId: staleObserved.observation.observationId,

      observeFresh: async () => {
        const current = await context.surface.observe({
          timeoutMs: 5_000,
          maxTextLength: 8_000,
          maxControls: 100,
        });

        if (current.status !== 'success') {
          throw new Error(`Fresh resume observation failed: ${current.error.message}`);
        }

        return current.observation;
      },

      evaluatePausedStepPostconditions: (observation) =>
        Promise.resolve(
          observation.visibleText.includes('Sub-account created')
            ? {
                status: 'passed' as const,
              }
            : {
                status: 'not_satisfied' as const,
                reason: 'Synthetic creation success text is absent after human resume.',
                details: {
                  expected: 'Sub-account created',
                  observed: observation.visibleText,
                },
              },
        ),
    });

    if (resume.status !== 'manual_step_resolved') {
      await coordinator.fail({
        code: 'ACTION_FAILED',
        phase: 'hitl_resume',
        resume,
      });

      finalized = true;

      throw new Error(
        `Human action did not satisfy the paused step postcondition: ${resume.status}`,
      );
    }

    /*
     * Important: no automated click of Confirm Create Sub-Account occurs here.
     * The human-completed irreversible step is treated as resolved only after
     * a fresh observation verifies its postcondition.
     */
    await context.evidenceRecorder.recordEvent({
      step: 6,
      eventType: 'intervention',
      result: {
        kind: 'resume_verified',
        interventionId: intervention.id,
        sessionId: context.sessionManager.sessionId,
        freshObservationId: resume.freshObservationId,
        pausedStepId: resume.stepId,
        duplicateRiskyActionExecuted: false,
      },
    });

    const finalObservation = await context.surface.observe({
      timeoutMs: 5_000,
      maxTextLength: 8_000,
      maxControls: 100,
    });

    if (
      finalObservation.status !== 'success' ||
      !finalObservation.observation.visibleText.includes('Sub-account created')
    ) {
      throw new Error('Expected terminal synthetic sub-account-created state was not observed');
    }

    const summary = await coordinator.finish({
      status: 'success',
      result: {
        capabilityId: CAPABILITY_ID,
        capabilityVersion: CAPABILITY_VERSION,
        interventionId: intervention.id,
        sessionId: context.sessionManager.sessionId,
        manualStepResolved: true,
        duplicateRiskyActionExecuted: false,
        terminalState: 'Sub-account created',
      },
    });

    finalized = true;

    process.stdout.write('\n=== REAL HITL DEMO SUCCEEDED ===\n');
    process.stdout.write(`Run ID: ${runId}\n`);
    process.stdout.write(`Intervention ID: ${intervention.id}\n`);
    process.stdout.write(`Session ID: ${context.sessionManager.sessionId}\n`);
    process.stdout.write(`Evidence directory: evidence/${runId}\n`);
    process.stdout.write(`Run status: ${summary.status}\n\n`);
    process.stdout.write('Next freeze the reviewer package:\n');
    process.stdout.write(
      `  npm run freeze-human-handoff-evidence -- ${intervention.id} ${runId}\n`,
    );
    process.stdout.write('Then verify it:\n');
    process.stdout.write('  npm run verify-human-handoff-evidence\n');
  } catch (error) {
    if (!finalized && coordinator.state === 'ACTIVE') {
      await coordinator
        .fail({
          code: 'APPLICATION_ERROR',
          phase: 'real_hitl_demo',
          message: error instanceof Error ? error.message : 'Unknown HITL demo failure',
        })
        .catch(() => undefined);
    }

    throw error;
  } finally {
    await operatorServer?.close().catch(() => undefined);
    await closeServer(demo.server).catch(() => undefined);
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  process.stderr.write(`Real HITL demo failed: ${message}\n`);
  process.exitCode = 1;
});
