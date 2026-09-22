import { once } from 'node:events';

import { mkdtemp, readFile, rm } from 'node:fs/promises';

import { tmpdir } from 'node:os';

import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createDemoServer } from '../../demo-app/server.js';

import { ArtifactStore } from '../../src/artifact/index.js';

import { PolicyEngine } from '../../src/policy/index.js';

import {
  ReplayBrowserStepExecutor,
  ReplayEngine,
  ReplayOutputStore,
  evaluateReplaySuccessCondition,
} from '../../src/replay/index.js';

import { RunCoordinator } from '../../src/runtime/index.js';

import { PlaywrightSurface } from '../../src/surface/playwright/index.js';

import type { PlaywrightStrategy } from '../../src/surface/playwright/index.js';

const directories: string[] = [];

async function temporaryEvidenceRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'real-replay-'));

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

describe('real deterministic replay', () => {
  it('replays lookup_savings_balance v1.0.0 against the real demo UI and saves evidence', async () => {
    const server = createDemoServer();

    server.listen(0, '127.0.0.1');

    await once(server, 'listening');

    const address = server.address();

    if (address === null || typeof address === 'string') {
      throw new Error('Demo server has no port');
    }

    const origin = `http://127.0.0.1:${address.port}`;

    const entryUrl = `${origin}/member-search?scenario=normal`;

    const evidenceRoot = await temporaryEvidenceRoot();

    const runId = 'real-replay-success';

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

      context.sessionManager.access('REPLAY');

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

        assertAutomationOwnership() {
          context.sessionManager.access('REPLAY');
        },
      });

      const engine = new ReplayEngine({
        artifactStore,

        stepExecutor,
      });

      const ordered = await engine.runOrderedSteps({
        capabilityId: 'lookup_savings_balance',

        version: '1.0.0',

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

      expect(ordered).toEqual({
        status: 'success',

        stepsExecuted: 4,

        outputs: {
          savingsBalance: '$12,840.50',
        },
      });

      const artifact = await artifactStore.load('lookup_savings_balance', '1.0.0');

      const outputStore = new ReplayOutputStore(artifact);

      if (ordered.status !== 'success') {
        throw new Error('Expected successful ordered replay');
      }

      const stored = outputStore.store(
        {
          kind: 'outputRef',

          name: 'savingsBalance',
        },

        ordered.outputs.savingsBalance,
      );

      expect(stored.status).toBe('stored');

      const successCondition = await evaluateReplaySuccessCondition({
        adapter: context.surface,

        condition: artifact.successCondition,

        outputStore,

        wait: {
          timeoutMs: 5_000,

          pollIntervalMs: 100,
        },
      });

      expect(successCondition.status).toBe('passed');

      const evidence = await coordinator.finish({
        status: 'success',

        result: {
          outputs: ordered.outputs,
        },
      });

      expect(evidence.status).toBe('success');

      const events = await readFile(join(evidenceRoot, runId, 'events.jsonl'), 'utf8');

      expect(events).toContain('session_lifecycle');

      expect(events).toContain('run_finished');

      expect(events).toContain('$12,840.50');
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
