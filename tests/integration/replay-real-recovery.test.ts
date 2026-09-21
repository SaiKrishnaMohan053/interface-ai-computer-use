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
  const root = await mkdtemp(join(tmpdir(), 'real-replay-recovery-'));

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

describe('real recoverable replay', () => {
  it('recovers from the real known interstitial and continues replay successfully', async () => {
    const server = createDemoServer();

    server.listen(0, '127.0.0.1');

    await once(server, 'listening');

    const address = server.address();

    if (address === null || typeof address === 'string') {
      throw new Error('Demo server has no port');
    }

    const origin = `http://127.0.0.1:${address.port}`;

    const entryUrl = `${origin}/member-search?scenario=dialog`;

    const evidenceRoot = await temporaryEvidenceRoot();

    const runId = 'real-replay-recovery';

    const recoveryEvents: Array<{
      readonly conditionCode: string;
      readonly attempt: number;
      readonly outcome: string;
    }> = [];

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

        recordRecoveryAttempt: (event) => {
          recoveryEvents.push({
            conditionCode: event.conditionCode,
            attempt: event.attempt,
            outcome: event.outcome,
          });

          return Promise.resolve();
        },
      });

      const engine = new ReplayEngine({
        artifactStore,

        stepExecutor,
      });

      const ordered = await engine.runOrderedSteps({
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

      expect(ordered).toEqual({
        status: 'success',

        stepsExecuted: 4,

        outputs: {
          savingsBalance: '$12,840.50',
        },
      });

      expect(
        recoveryEvents.some(
          (event) => event.conditionCode === 'KNOWN_INTERSTITIAL' && event.outcome === 'dismissed',
        ),
      ).toBe(true);

      expect(
        recoveryEvents.filter(
          (event) => event.conditionCode === 'KNOWN_INTERSTITIAL' && event.outcome === 'dismissed',
        ),
      ).toHaveLength(1);

      const artifact = await artifactStore.load('lookup_savings_balance', '1.0.1');

      const outputStore = new ReplayOutputStore(artifact);

      if (ordered.status !== 'success') {
        throw new Error('Expected successful recovered replay');
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

          recoveryEvents,
        },
      });

      expect(evidence.status).toBe('success');

      const events = await readFile(join(evidenceRoot, runId, 'events.jsonl'), 'utf8');

      expect(events).toContain('KNOWN_INTERSTITIAL');

      expect(events).toContain('dismissed');

      expect(events).toContain('$12,840.50');

      expect(events).toContain('run_finished');
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
