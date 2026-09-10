import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PolicyEngine } from '../../src/policy/index.js';
import { RunCoordinator, RunCoordinatorError } from '../../src/runtime/index.js';
import { PlaywrightSurface } from '../../src/surface/playwright/index.js';
import type { PlaywrightStrategy } from '../../src/surface/playwright/index.js';

const directories: string[] = [];

const policyEngine = new PolicyEngine({
  policyId: 'coordinator-test-policy',
  version: 1,
  defaultDecision: 'DENY',

  allowedOrigins: ['http://127.0.0.1:3000'],

  allowedRoutes: [
    {
      routeId: 'member-search',
      description: 'Member search route',
      match: {
        kind: 'exact',
        pathname: '/member-search',
      },
    },
  ],

  allowedActions: ['read'],

  riskRules: [
    {
      ruleId: 'read-only',
      description: 'Allow reads',
      match: {
        actions: ['read'],
      },
      riskLevel: 'READ_ONLY',
      decision: 'ALLOW',
    },
  ],
});

async function evidenceRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'run-coordinator-'));

  directories.push(path);

  return path;
}

function coordinator(): RunCoordinator<PlaywrightStrategy> {
  return new RunCoordinator({
    policyEngine,

    createSurface: ({ access, surfaceId }) =>
      new PlaywrightSurface(access.page, {
        sessionId: access.sessionId,
        surfaceId,
      }),
  });
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) =>
      rm(path, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe('RunCoordinator lifecycle', () => {
  it('starts evidence, activates a session, acquires ownership and creates a surface', async () => {
    const root = await evidenceRoot();

    const run = coordinator();

    const context = await run.start({
      runId: 'coordinator-start',
      mode: 'DISCOVERY',
      evidenceRoot: root,
    });

    expect(run.snapshot()).toMatchObject({
      state: 'ACTIVE',
      runId: 'coordinator-start',
      mode: 'DISCOVERY',
      sessionId: context.sessionManager.sessionId,
    });

    expect(context.sessionManager.snapshot()).toMatchObject({
      state: 'ACTIVE',
      owner: 'DISCOVERY',
    });

    expect(context.surface.scope.sessionId).toBe(context.sessionManager.sessionId);

    expect(context.policyEngine).toBe(policyEngine);

    await run.finish({
      status: 'success',
      result: {
        completed: true,
      },
    });
  });

  it('finishes evidence and closes the owned session', async () => {
    const root = await evidenceRoot();

    const run = coordinator();

    const context = await run.start({
      runId: 'coordinator-finish',
      mode: 'REPLAY',
      evidenceRoot: root,
    });

    const summary = await run.finish({
      status: 'business_outcome',
      result: {
        code: 'MEMBER_NOT_FOUND',
      },
    });

    expect(run.state).toBe('CLOSED');

    expect(context.sessionManager.snapshot()).toMatchObject({
      state: 'CLOSED',
      owner: 'NONE',
    });

    expect(summary).toMatchObject({
      runId: 'coordinator-finish',
      mode: 'REPLAY',
      status: 'business_outcome',
    });

    const events = await readFile(join(root, 'coordinator-finish', 'events.jsonl'), 'utf8');

    expect(events).toContain('session_lifecycle');

    expect(events).toContain('run_finished');
  });

  it('marks the session and run failed without persisting raw failure secrets', async () => {
    const root = await evidenceRoot();

    const run = coordinator();

    const context = await run.start({
      runId: 'coordinator-failure',
      mode: 'DISCOVERY',
      evidenceRoot: root,
    });

    const summary = await run.fail({
      code: 'APPLICATION_ERROR',
      authorization: 'Bearer raw-secret',
    });

    expect(run.state).toBe('FAILED');

    expect(context.sessionManager.state).toBe('FAILED');

    expect(summary.status).toBe('failure');

    const events = await readFile(join(root, 'coordinator-failure', 'events.jsonl'), 'utf8');

    expect(events).not.toContain('raw-secret');

    expect(events).toContain('[REDACTED]');
  });

  it('rejects duplicate starts and lifecycle calls after completion', async () => {
    const root = await evidenceRoot();

    const run = coordinator();

    await run.start({
      runId: 'coordinator-state',
      mode: 'DISCOVERY',
      evidenceRoot: root,
    });

    await expect(
      run.start({
        runId: 'another-run',
        mode: 'REPLAY',
        evidenceRoot: root,
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_COORDINATOR_STATE',
    });

    await run.finish({
      status: 'success',
      result: null,
    });

    expect(() => run.context()).toThrowError(RunCoordinatorError);

    await expect(
      run.fail({
        code: 'ACTION_FAILED',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_COORDINATOR_STATE',
    });
  });
});
