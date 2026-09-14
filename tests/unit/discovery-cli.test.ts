import { describe, expect, it } from 'vitest';

import { runDiscoveryCli } from '../../src/cli/discover-command.js';
import type { DiscoveryAssignmentExecution } from '../../src/cli/discover-runtime.js';

function successExecution(): DiscoveryAssignmentExecution {
  return {
    target: 'http://127.0.0.1:3000/member-search',
    evidenceDirectory: 'C:\\repo\\evidence\\run-1',
    result: {
      status: 'success',
      runId: 'run-1',
      sessionId: 'session-1',
      startedAt: '2026-09-14T20:00:00.000Z',
      finishedAt: '2026-09-14T20:00:01.000Z',
      durationMs: 1_000,
      evidenceRefs: [],
      recoverableConditions: [],
      steps: 4,
      outputs: { savingsBalance: '$12,840.50' },
    },
  };
}

describe('Discovery CLI', () => {
  it('prints the structured result and evidence location', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runDiscoveryCli(['--goal', 'Read the Savings balance'], {
      execute: () => Promise.resolve(successExecution()),
      io: {
        writeOut: (value) => stdout.push(value),
        writeError: (value) => stderr.push(value),
      },
    });

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      result: {
        status: 'success',
        outputs: { savingsBalance: '$12,840.50' },
      },
      evidenceDirectory: 'C:\\repo\\evidence\\run-1',
    });
  });

  it('uses a distinct clean exit code for intervention', async () => {
    const execution = successExecution();
    const intervention = {
      ...execution,
      result: {
        ...execution.result,
        status: 'intervention_required' as const,
        intervention: {
          interventionId: 'intervention-1',
          code: 'AUTOMATION_STUCK' as const,
          message: 'Safe progress could not be made',
          requestedOwner: 'HUMAN' as const,
          resumable: false,
          context: {},
        },
      },
    } as DiscoveryAssignmentExecution;

    await expect(
      runDiscoveryCli(['--goal', 'Read'], {
        execute: () => Promise.resolve(intervention),
        io: { writeOut: () => undefined, writeError: () => undefined },
      }),
    ).resolves.toBe(2);
  });

  it('does not print arbitrary internal exception content', async () => {
    const stderr: string[] = [];

    const exitCode = await runDiscoveryCli(['--goal', 'Read'], {
      execute: () => Promise.reject(new Error('OPENAI_API_KEY=secret-value')),
      io: {
        writeOut: () => undefined,
        writeError: (value) => stderr.push(value),
      },
    });

    expect(exitCode).toBe(1);
    expect(stderr.join('')).toContain('DISCOVERY_CLI_FAILED');
    expect(stderr.join('')).not.toContain('secret-value');
  });

  it('prints usage without executing discovery', async () => {
    const stdout: string[] = [];
    let executed = false;

    const exitCode = await runDiscoveryCli(['--help'], {
      execute: () => {
        executed = true;
        return Promise.resolve(successExecution());
      },
      io: {
        writeOut: (value) => stdout.push(value),
        writeError: () => undefined,
      },
    });

    expect(exitCode).toBe(0);
    expect(executed).toBe(false);
    expect(stdout.join('')).toContain('npm run discover');
  });
});
