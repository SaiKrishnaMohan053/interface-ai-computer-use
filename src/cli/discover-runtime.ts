import { once } from 'node:events';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { createDemoServer } from '../../demo-app/server.js';
import {
  DiscoveryEngine,
  createOpenAIDiscoveryDecisionModelFromEnvironment,
} from '../discovery/index.js';
import type { DiscoveryRunResult } from '../discovery/index.js';
import { POLICY_ACTION_KINDS, PolicyEngine } from '../policy/index.js';
import type { PolicyActionKind, RiskLevel } from '../policy/index.js';
import { RunCoordinator } from '../runtime/index.js';
import { PlaywrightSurface } from '../surface/playwright/index.js';
import type { PlaywrightStrategy } from '../surface/playwright/index.js';

import type { DiscoverCommandOptions } from './discover-options.js';

export interface DiscoveryAssignmentExecution {
  readonly result: DiscoveryRunResult;
  readonly evidenceDirectory: string;
  readonly target: string;
}

interface StartedDemo {
  readonly target: string;
  close(): Promise<void>;
}

function riskFor(action: PolicyActionKind): RiskLevel {
  return action === 'navigate' || action === 'read' || action === 'wait'
    ? 'READ_ONLY'
    : 'REVERSIBLE';
}

export function createDiscoveryCliPolicy(target: string): PolicyEngine {
  const url = new URL(target);

  return new PolicyEngine({
    policyId: 'assignment-discovery-policy',
    version: 1,
    defaultDecision: 'DENY',
    allowedOrigins: [url.origin],
    allowedRoutes: [
      {
        routeId: 'assignment-demo',
        description: 'Routes on the explicitly supplied assignment target',
        match: { kind: 'prefix', pathname: '/' },
      },
    ],
    allowedActions: [...POLICY_ACTION_KINDS],
    riskRules: POLICY_ACTION_KINDS.map((action) => ({
      ruleId: `assignment-${action}`,
      description: `Assignment discovery ${action} policy`,
      match: {
        actions: [action],
        routeIds: ['assignment-demo'],
      },
      riskLevel: riskFor(action),
      decision: 'ALLOW',
    })),
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;

  const closed = new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error === undefined) resolveClose();
      else rejectClose(error);
    });
  });

  server.closeAllConnections();
  await closed;
}

async function startDemo(): Promise<StartedDemo> {
  const server = createDemoServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();

  if (address === null || typeof address === 'string') {
    await closeServer(server);
    throw new Error('Demo server did not expose a TCP port');
  }

  return {
    target: `http://127.0.0.1:${address.port}/member-search`,
    close: () => closeServer(server),
  };
}

export async function runDiscoveryAssignment(
  options: DiscoverCommandOptions,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<DiscoveryAssignmentExecution> {
  // Validate model configuration before allocating a browser or local server.
  const model = createOpenAIDiscoveryDecisionModelFromEnvironment(environment);
  const runId = randomUUID();
  const startedDemo = options.target === undefined ? await startDemo() : null;
  const target = options.target ?? startedDemo?.target;

  if (target === undefined) {
    throw new Error('Discovery target was not resolved');
  }

  try {
    const coordinator = new RunCoordinator<PlaywrightStrategy>({
      policyEngine: createDiscoveryCliPolicy(target),
      createSurface: ({ access, surfaceId }) =>
        new PlaywrightSurface(access.page, {
          sessionId: access.sessionId,
          surfaceId,
        }),
    });

    const engine = new DiscoveryEngine({ coordinator, model });
    const result = await engine.run(
      {
        goal: options.goal,
        target: {
          entryUrl: target,
          application: options.application,
        },
        ...(options.maxSteps === undefined && options.timeoutMs === undefined
          ? {}
          : {
              limits: {
                ...(options.maxSteps === undefined ? {} : { maxSteps: options.maxSteps }),
                ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
              },
            }),
      },
      {
        runId,
        evidenceRoot: options.evidenceRoot,
        headed: options.headed,
        screenshotEvidence:
          startedDemo !== null || options.syntheticScreenshots ? 'synthetic_fixture' : 'none',
      },
    );

    return {
      result,
      evidenceDirectory: resolve(options.evidenceRoot, runId),
      target,
    };
  } finally {
    await startedDemo?.close().catch(() => undefined);
  }
}
