import { once } from 'node:events';

import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';

import { tmpdir } from 'node:os';

import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createDemoServer } from '../../demo-app/server.js';

import { ArtifactStore } from '../../src/artifact/index.js';

import { PolicyEngine } from '../../src/policy/index.js';

import { ReplayBrowserStepExecutor, ReplayEngine } from '../../src/replay/index.js';

import type { ReplayEvidenceSink } from '../../src/replay/index.js';

import { RunCoordinator } from '../../src/runtime/index.js';

import { PlaywrightSurface } from '../../src/surface/playwright/index.js';

import type { PlaywrightStrategy } from '../../src/surface/playwright/index.js';

const directories: string[] = [];

async function temporaryEvidenceRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'real-replay-hard-failure-'));

  directories.push(root);

  return root;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe('real hard-failure replay', () => {
  it('returns APPLICATION_ERROR with screenshot evidence against the real demo UI', async () => {
    const server = createDemoServer();

    server.listen(0, '127.0.0.1');

    await once(server, 'listening');

    const address = server.address();

    if (address === null || typeof address === 'string') {
      throw new Error('Demo server has no port');
    }

    const origin = `http://127.0.0.1:${address.port}`;

    const entryUrl = `${origin}/member-search?scenario=app-error`;

    const evidenceRoot = await temporaryEvidenceRoot();

    const runId = 'real-replay-hard-failure';

    const artifactStore = new ArtifactStore({
      rootDir: resolve('artifacts'),
    });

    const policyEngine = new PolicyEngine({
      policyId: 'real-replay-test-policy',

      version: 1,

      defaultDecision: 'DENY',

      allowedOrigins: [origin],

      allowedRoutes: [
        {
          routeId: 'member-search',

          description: 'Member search',

          match: {
            kind: 'exact',

            pathname: '/member-search',
          },
        },

        {
          routeId: 'member-details',

          description: 'Member details',

          match: {
            kind: 'prefix',

            pathname: '/member/',
          },
        },
      ],

      allowedActions: ['navigate', 'type', 'click', 'read'],

      riskRules: [
        {
          ruleId: 'read-only',

          description: 'Allow read-only replay operations',

          match: {
            actions: ['navigate', 'click', 'read'],
          },

          riskLevel: 'READ_ONLY',

          decision: 'ALLOW',
        },

        {
          ruleId: 'reversible',

          description: 'Allow reversible replay input',

          match: {
            actions: ['type'],
          },

          riskLevel: 'REVERSIBLE',

          decision: 'ALLOW',
        },
      ],
    });

    const coordinator = new RunCoordinator<PlaywrightStrategy>({
      policyEngine,

      createSurface: ({ access, surfaceId }) =>
        new PlaywrightSurface(access.page, {
          sessionId: access.sessionId,

          surfaceId,
        }),
    });

    try {
      const context = await coordinator.start({
        runId,

        mode: 'REPLAY',

        evidenceRoot,

        headed: process.env.HEADED === '1',

        timeoutMs: 10_000,
      });

      /*
       * Adapter from replay-specific evidence
       * contracts into the existing run recorder.
       *
       * This test uses only synthetic demo data,
       * therefore screenshot persistence is allowed
       * under SYNTHETIC_FIXTURE_ONLY.
       */
      const replayEvidenceSink: ReplayEvidenceSink = {
        recordEvent: (event) =>
          context.evidenceRecorder.recordEvent({
            step: event.step,

            eventType: event.eventType,

            result: {
              stepId: event.stepId ?? null,

              details: event.details,
            },

            evidenceRefs: event.evidenceRefs,
          }),

        persistCapturedEvidence: async (captured, metadata) => {
          if (captured.kind !== 'screenshot') {
            throw new Error(
              `Unsupported captured evidence kind "${captured.kind}" in real replay integration.`,
            );
          }

          return context.evidenceRecorder.captureScreenshot({
            step: metadata.step,

            bytes: captured.bytes,

            capturedAt: captured.capturedAt,

            dataHandling: 'SYNTHETIC_FIXTURE_ONLY',
          });
        },
      };

      const navigation = await context.surface.perform(
        {
          actionId: 'replay-entry-navigation',

          action: {
            kind: 'navigate',

            destination: entryUrl,
          },
        },

        {
          timeoutMs: 5_000,
        },
      );

      expect(navigation.status).toBe('success');

      const stepExecutor = new ReplayBrowserStepExecutor({
        surface: context.surface,

        policyEngine: context.policyEngine,

        operationTimeoutMs: 5_000,

        evidenceSink: replayEvidenceSink,
      });

      const engine = new ReplayEngine({
        artifactStore,

        stepExecutor,
      });

      const result = await engine.runOrderedSteps({
        capabilityId: 'lookup_savings_balance',

        version: '1.0.1',

        inputs: {
          memberName: 'Alex Morgan',
        },

        target: {
          entryUrl,
        },

        options: {
          timeoutMs: 10_000,
        },
      });

      expect(result.status).toBe('failure');

      if (result.status !== 'failure') {
        throw new Error('Expected hard failure');
      }

      expect(result.stepId).toBe('enter-member-search');

      expect(result.stepsExecuted).toBe(0);

      expect(result.error.code).toBe('APPLICATION_ERROR');

      const evidence = await coordinator.fail({
        code: result.error.code,

        stepId: result.stepId,

        stepsExecuted: result.stepsExecuted,

        message: result.error.message,
      });

      expect(evidence.status).toBe('failure');

      expect(evidence.evidenceRefs.some((reference) => reference.kind === 'screenshot')).toBe(true);

      const screenshotDirectory = join(evidenceRoot, runId, 'screenshots');

      const screenshotFiles = await readdir(screenshotDirectory);

      expect(screenshotFiles.some((file) => file.endsWith('.png'))).toBe(true);

      expect(screenshotFiles).toContain('screenshot-0001.png');

      const events = await readFile(
        join(evidenceRoot, runId, 'events.jsonl'),

        'utf8',
      );

      expect(events).toContain('APPLICATION_ERROR');

      expect(events).toContain('enter-member-search');

      expect(events).toContain('replay.failed');

      expect(events).toContain('evidence_captured');

      expect(events).toContain('screenshot-0001.png');

      expect(events).toContain('"screenshotCaptured":true');
    } finally {
      if (coordinator.state === 'ACTIVE') {
        await coordinator
          .fail({
            code: 'ACTION_FAILED',

            phase: 'integration_cleanup',
          })
          .catch(() => undefined);
      }

      server.close();

      await once(server, 'close');
    }
  });
});
