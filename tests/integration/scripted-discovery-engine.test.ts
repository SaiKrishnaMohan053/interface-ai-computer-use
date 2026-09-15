import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createDemoServer } from '../../demo-app/server.js';
import { DiscoveryEngine } from '../../src/discovery/index.js';
import type { DiscoveryDecision } from '../../src/discovery/index.js';
import { POLICY_ACTION_KINDS, PolicyEngine } from '../../src/policy/index.js';
import type { PolicyActionKind, RiskLevel } from '../../src/policy/index.js';
import { RunCoordinator } from '../../src/runtime/index.js';
import { PlaywrightSurface } from '../../src/surface/playwright/index.js';
import type { PlaywrightStrategy } from '../../src/surface/playwright/index.js';

import { ScriptedDiscoveryDecisionModel } from '../helpers/scripted-discovery-model.js';

function riskFor(action: PolicyActionKind): RiskLevel {
  return action === 'navigate' || action === 'read' || action === 'wait'
    ? 'READ_ONLY'
    : 'REVERSIBLE';
}

function policy(target: string): PolicyEngine {
  const url = new URL(target);

  return new PolicyEngine({
    policyId: 'scripted-discovery-policy',
    version: 1,
    defaultDecision: 'DENY',

    allowedOrigins: [url.origin],

    allowedRoutes: [
      {
        routeId: 'demo',
        description: 'Local deterministic discovery fixture',
        match: {
          kind: 'prefix',
          pathname: '/',
        },
      },
    ],

    allowedActions: [...POLICY_ACTION_KINDS],

    riskRules: POLICY_ACTION_KINDS.map((action) => ({
      ruleId: `scripted-${action}`,
      description: `Allow ${action} in the local deterministic fixture`,
      match: {
        actions: [action],
        routeIds: ['demo'],
      },
      riskLevel: riskFor(action),
      decision: 'ALLOW',
    })),
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  const closed = new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error === undefined) {
        resolveClose();
      } else {
        rejectClose(error);
      }
    });
  });

  server.closeAllConnections();
  await closed;
}

const textMatch = (value: string) => ({
  value,
  mode: 'exact' as const,
  caseSensitive: false,
});

function scriptedDecisions(): readonly DiscoveryDecision[] {
  return [
    {
      kind: 'type',
      target: {
        description: 'Member name input',
        strategies: [
          {
            kind: 'label',
            label: textMatch('Member Name'),
          },
        ],
        cardinality: 'exactly-one',
      },
      text: 'Alex Morgan',
      mode: 'replace',
      reason: 'Enter the member name from the test goal',
    },

    {
      kind: 'click',
      target: {
        description: 'Member search button',
        strategies: [
          {
            kind: 'role-name',
            role: 'button',
            name: textMatch('Search'),
          },
        ],
        cardinality: 'exactly-one',
      },
      reason: 'Run the member lookup',
    },

    {
      kind: 'click',
      target: {
        description: 'Accounts link',
        strategies: [
          {
            kind: 'role-name',
            role: 'link',
            name: textMatch('Accounts'),
          },
        ],
        cardinality: 'exactly-one',
      },
      reason: 'Open the observed accounts page',
    },

    {
      kind: 'read',
      target: {
        description: 'Savings current balance',
        strategies: [
          {
            kind: 'structural',
            query: {
              kind: 'table-cell',
              table: {
                name: textMatch('Accounts'),
              },
              row: {
                columnHeader: textMatch('Account Type'),
                value: textMatch('Savings'),
              },
              column: {
                header: textMatch('Current Balance'),
              },
            },
          },
        ],
        cardinality: 'exactly-one',
      },
      source: 'text',
      saveAs: 'savingsBalance',
      reason: 'Read the Savings row current balance',
    },

    {
      kind: 'complete',
      summary: 'Savings balance was read from the observed Accounts table',
      outputs: {
        savingsBalance: '$12,840.50',
      },
    },
  ];
}

describe('DiscoveryEngine with a deterministic scripted model', () => {
  it('completes the real demo lookup without an OpenAI call', async () => {
    const evidenceRoot = await mkdtemp(join(tmpdir(), 'scripted-discovery-'));

    const server = createDemoServer();

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    const address = server.address();

    if (address === null || typeof address === 'string') {
      await closeServer(server);

      throw new Error('Demo server did not expose a TCP port');
    }

    const target = `http://127.0.0.1:${address.port}` + '/member-search';

    const model = new ScriptedDiscoveryDecisionModel(scriptedDecisions());

    try {
      const coordinator = new RunCoordinator<PlaywrightStrategy>({
        policyEngine: policy(target),

        createSurface: ({ access, surfaceId }) =>
          new PlaywrightSurface(access.page, {
            sessionId: access.sessionId,
            surfaceId,
          }),
      });

      const engine = new DiscoveryEngine({
        coordinator,
        model,
      });

      const result = await engine.run(
        {
          goal: 'Look up Alex Morgan and return their current savings balance.',

          target: {
            entryUrl: target,
            application: 'Demo Credit Union',
          },

          limits: {
            maxSteps: 10,
            timeoutMs: 60_000,
          },
        },
        {
          evidenceRoot,
          headed: false,
          screenshotEvidence: 'none',
        },
      );

      expect(result).toMatchObject({
        status: 'success',
        steps: 5,
        outputs: {
          savingsBalance: '$12,840.50',
        },
      });

      expect(model.calls).toBe(5);
      expect(model.remaining).toBe(0);

      expect(model.inputs.map((input) => input.observation.step)).toEqual([1, 2, 3, 4, 5]);

      expect(result.runId).toEqual(expect.any(String));

      expect(result.sessionId).toEqual(expect.any(String));

      const eventLines = (await readFile(join(evidenceRoot, result.runId, 'events.jsonl'), 'utf8'))
        .trim()
        .split(/\r?\n/)
        .map(
          (line) =>
            JSON.parse(line) as {
              readonly eventType: string;
            },
        );

      const eventTypes = eventLines.map((event) => event.eventType);

      expect(eventTypes).toEqual(
        expect.arrayContaining([
          'run_started',
          'discovery.started',
          'observation.captured',
          'model.decision.received',
          'policy.evaluated',
          'target.resolved',
          'action.completed',
          'value.extracted',
          'discovery.completed',
          'run_finished',
        ]),
      );

      /*
       * type, Search click, Accounts click,
       * read, and complete.
       */
      expect(
        eventTypes.filter((eventType) => eventType === 'model.decision.received'),
      ).toHaveLength(5);

      /*
       * type, Search click, Accounts click,
       * and Savings balance read all require
       * target resolution.
       */
      expect(eventTypes.filter((eventType) => eventType === 'target.resolved')).toHaveLength(4);

      expect(eventTypes.filter((eventType) => eventType === 'value.extracted')).toHaveLength(1);
    } finally {
      await closeServer(server);

      await rm(evidenceRoot, {
        recursive: true,
        force: true,
      });
    }
  }, 90_000);
});
