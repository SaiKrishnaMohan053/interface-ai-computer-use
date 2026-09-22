import { once } from 'node:events';

import { mkdtemp, readFile, rm } from 'node:fs/promises';

import { tmpdir } from 'node:os';

import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createDemoServer } from '../../demo-app/server.js';

import { ArtifactStore } from '../../src/artifact/index.js';

import { PolicyEngine } from '../../src/policy/index.js';

import { ReplayBrowserStepExecutor, ReplayEngine } from '../../src/replay/index.js';

import { RunCoordinator } from '../../src/runtime/index.js';

import { PlaywrightSurface } from '../../src/surface/playwright/index.js';

import type { PlaywrightStrategy } from '../../src/surface/playwright/index.js';

const directories: string[] = [];

async function temporaryEvidenceRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'real-replay-business-outcome-'));

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

describe('real business-outcome replay', () => {
  it('returns MEMBER_NOT_FOUND as a business outcome against the real demo UI', async () => {
    const server = createDemoServer();

    server.listen(0, '127.0.0.1');

    await once(server, 'listening');

    const address = server.address();

    if (address === null || typeof address === 'string') {
      throw new Error('Demo server has no port');
    }

    const origin = `http://127.0.0.1:${address.port}`;

    const entryUrl = `${origin}/member-search`;

    const evidenceRoot = await temporaryEvidenceRoot();

    const runId = 'real-replay-member-not-found';

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

        assertAutomationOwnership: () => {
          context.sessionManager.access('REPLAY');
        },
      });

      const engine = new ReplayEngine({
        artifactStore,

        stepExecutor,
      });

      const result = await engine.runOrderedSteps({
        capabilityId: 'lookup_savings_balance',

        version: '1.0.1',

        inputs: {
          memberName: 'Unknown Member',
        },

        target: {
          entryUrl,
        },

        options: {
          timeoutMs: 10_000,
        },
      });

      expect(result.status).toBe('business_outcome');

      if (result.status !== 'business_outcome') {
        throw new Error('Expected business outcome');
      }

      expect(result.stepId).toBe('submit-member-search');

      /*
       * enter-member-search completed.
       * submit-member-search terminates with the
       * business outcome and therefore is not counted
       * as a successfully completed step.
       */
      expect(result.stepsExecuted).toBe(1);

      expect(result.outcome.code).toBe('MEMBER_NOT_FOUND');

      /*
       * MEMBER_NOT_FOUND must remain a legitimate
       * capability/domain result rather than being
       * collapsed into a replay failure.
       */
      expect(result.status).not.toBe('failure');

      const evidence = await coordinator.finish({
        status: 'business_outcome',

        result: {
          code: result.outcome.code,

          stepId: result.stepId,

          stepsExecuted: result.stepsExecuted,

          ...(result.outcome.details === undefined
            ? {}
            : {
                details: result.outcome.details,
              }),
        },
      });

      expect(evidence.status).toBe('business_outcome');

      const events = await readFile(join(evidenceRoot, runId, 'events.jsonl'), 'utf8');

      expect(events).toContain('MEMBER_NOT_FOUND');

      expect(events).toContain('submit-member-search');

      const persistedResult = await readFile(join(evidenceRoot, runId, 'result.json'), 'utf8');

      expect(persistedResult).toContain('business_outcome');

      expect(persistedResult).toContain('MEMBER_NOT_FOUND');
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
