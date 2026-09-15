import { once } from 'node:events';

import { mkdtemp, readFile, rm } from 'node:fs/promises';

import type { Server } from 'node:http';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDemoServer } from '../../demo-app/server.js';

import type { ScenarioState } from '../../demo-app/types.js';

import { DiscoveryEngine } from '../../src/discovery/index.js';

import type { DiscoveryDecision, DiscoveryRunResult } from '../../src/discovery/index.js';

import { POLICY_ACTION_KINDS, PolicyEngine } from '../../src/policy/index.js';

import type { PolicyActionKind, RiskLevel } from '../../src/policy/index.js';

import { RunCoordinator } from '../../src/runtime/index.js';

import { PlaywrightSurface } from '../../src/surface/playwright/index.js';

import type { PlaywrightStrategy } from '../../src/surface/playwright/index.js';

import {
  ScriptedDiscoveryDecisionModel,
  createKnownDialogSavingsBalanceScript,
  createSavingsBalanceDiscoveryScript,
} from '../helpers/scripted-discovery-model.js';

interface PersistedEvent {
  readonly eventType: string;
  readonly step: number;
  readonly result: unknown;
}

interface ScenarioRun {
  readonly result: DiscoveryRunResult;

  readonly model: ScriptedDiscoveryDecisionModel;

  readonly events: readonly PersistedEvent[];
}

let server: Server;
let origin: string;
let evidenceRoot: string;

function riskFor(action: PolicyActionKind): RiskLevel {
  return action === 'navigate' || action === 'read' || action === 'wait'
    ? 'READ_ONLY'
    : 'REVERSIBLE';
}

function createPolicy(): PolicyEngine {
  return new PolicyEngine({
    policyId: 'scenario-discovery-policy',

    version: 1,

    defaultDecision: 'DENY',

    allowedOrigins: [origin],

    allowedRoutes: [
      {
        routeId: 'demo',

        description: 'Local scenario integration fixture',

        match: {
          kind: 'prefix',
          pathname: '/',
        },
      },
    ],

    allowedActions: [...POLICY_ACTION_KINDS],

    riskRules: POLICY_ACTION_KINDS.map((action) => ({
      ruleId: `scenario-${action}`,

      description: `Allow ${action} in the local scenario fixture`,

      match: {
        actions: [action],
        routeIds: ['demo'],
      },

      riskLevel: riskFor(action),

      decision: 'ALLOW',
    })),
  });
}

async function closeServer(): Promise<void> {
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

async function readEvents(runId: string): Promise<readonly PersistedEvent[]> {
  const contents = await readFile(join(evidenceRoot, runId, 'events.jsonl'), 'utf8');

  return contents
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line) as PersistedEvent);
}

async function runScenario(
  scenario: ScenarioState,
  decisions: readonly DiscoveryDecision[],
): Promise<ScenarioRun> {
  const model = new ScriptedDiscoveryDecisionModel(decisions);

  const coordinator = new RunCoordinator<PlaywrightStrategy>({
    policyEngine: createPolicy(),

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

  const target = `${origin}/member-search` + `?scenario=${scenario}`;

  const result = await engine.run(
    {
      goal: 'Look up Alex Morgan and return their current savings balance.',

      target: {
        entryUrl: target,

        application: 'Demo Credit Union',
      },

      limits: {
        maxSteps: 15,
        timeoutMs: 60_000,
      },
    },

    {
      evidenceRoot,
      headed: false,
      screenshotEvidence: 'none',
    },
  );

  return {
    result,
    model,

    events: await readEvents(result.runId),
  };
}

function eventTypes(run: ScenarioRun): readonly string[] {
  return run.events.map((event) => event.eventType);
}

beforeAll(async () => {
  evidenceRoot = await mkdtemp(join(tmpdir(), 'discovery-scenarios-'));

  server = createDemoServer();

  server.listen(0, '127.0.0.1');

  await once(server, 'listening');

  const address = server.address();

  if (address === null || typeof address === 'string') {
    await closeServer();

    throw new Error('Demo server did not expose a TCP port');
  }

  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await closeServer();

  await rm(evidenceRoot, {
    recursive: true,
    force: true,
  });
});

describe('DiscoveryEngine demo scenarios', () => {
  it('normal: completes the Savings balance lookup', async () => {
    const run = await runScenario('normal', createSavingsBalanceDiscoveryScript());

    expect(run.result).toMatchObject({
      status: 'success',
      steps: 5,

      outputs: {
        savingsBalance: '$12,840.50',
      },
    });

    expect(run.model.calls).toBe(5);

    expect(eventTypes(run)).toContain('value.extracted');

    expect(eventTypes(run)).toContain('discovery.completed');
  });

  it('slow: waits through bounded loading states and still completes', async () => {
    const run = await runScenario('slow', createSavingsBalanceDiscoveryScript());

    expect(run.result).toMatchObject({
      status: 'success',

      outputs: {
        savingsBalance: '$12,840.50',
      },
    });

    /*
     * Loading observations are handled by
     * the engine. They do not consume scripted
     * model decisions.
     */
    expect(run.model.calls).toBe(5);

    expect(eventTypes(run)).toContain('condition');

    expect(eventTypes(run)).toContain('discovery.completed');
  });

  it('permission-denied: returns a business outcome without blind continued actions', async () => {
    const run = await runScenario('permission-denied', createSavingsBalanceDiscoveryScript());

    expect(run.result).toMatchObject({
      status: 'business_outcome',

      outcome: {
        code: 'PERMISSION_DENIED',
      },
    });

    /*
     * Only type and Search decisions occur.
     * Accounts/read/complete remain unused.
     */
    expect(run.model.calls).toBe(2);
    expect(run.model.remaining).toBe(3);

    expect(eventTypes(run)).toContain('discovery.business_outcome');

    expect(eventTypes(run)).not.toContain('value.extracted');
  });

  it('session-expired: stops before consulting the model', async () => {
    const run = await runScenario('session-expired', createSavingsBalanceDiscoveryScript());

    expect(run.result).toMatchObject({
      status: 'failure',
      steps: 1,

      error: {
        code: 'SESSION_EXPIRED_UNRECOVERABLE',
      },
    });

    expect(run.model.calls).toBe(0);

    expect(eventTypes(run)).toContain('discovery.failed');

    expect(eventTypes(run)).not.toContain('model.decision.received');
  });

  it('dialog: explicitly continues through the known safe interstitial', async () => {
    const run = await runScenario('dialog', createKnownDialogSavingsBalanceScript());

    expect(run.result).toMatchObject({
      status: 'success',
      steps: 6,

      outputs: {
        savingsBalance: '$12,840.50',
      },
    });

    expect(run.model.calls).toBe(6);

    expect(run.model.inputs[0]?.observation.dialogs).toMatchObject([
      {
        kind: 'surface',

        presentation: 'interstitial',

        title: 'Scheduled Service Notice',

        controlNames: ['Continue'],
      },
    ]);

    expect(eventTypes(run)).toContain('discovery.completed');
  });

  it('application-error: returns a typed failure before consulting the model', async () => {
    const run = await runScenario('app-error', createSavingsBalanceDiscoveryScript());

    expect(run.result).toMatchObject({
      status: 'failure',
      steps: 1,

      error: {
        code: 'APPLICATION_ERROR',
      },
    });

    expect(run.model.calls).toBe(0);

    expect(eventTypes(run)).toContain('discovery.failed');

    expect(eventTypes(run)).not.toContain('model.decision.received');
  });
});
