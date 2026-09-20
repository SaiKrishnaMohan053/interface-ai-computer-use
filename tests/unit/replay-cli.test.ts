import { describe, expect, it, vi } from 'vitest';

import { parseReplayCliArgs, runReplayCli } from '../../src/replay/index.js';

import type { CapabilityArtifact } from '../../src/artifact/index.js';

import type { ReplayCliDependencies } from '../../src/replay/index.js';

function artifact(): CapabilityArtifact {
  return {
    schemaVersion: '1.0',

    identity: {
      id: 'lookup_savings_balance',

      name: 'Lookup savings balance',

      version: '1.0.0',

      description: 'Lookup savings balance.',
    },

    compatibility: {
      application: 'interface-ai-demo-bank',

      surfaceKind: 'web',
    },

    inputs: [],

    outputs: [],

    steps: [
      {
        id: 'step-1',

        description: 'Dummy step.',

        action: {
          kind: 'click',
        },

        target: {
          description: 'Dummy target',

          cardinality: 'exactly-one',

          strategies: [
            {
              kind: 'text',

              text: {
                value: 'Dummy',
                mode: 'exact',
                caseSensitive: false,
              },
            },
          ],
        },

        risk: 'READ_ONLY',
      },
    ],

    successCondition: {
      kind: 'surface',

      condition: {
        kind: 'textPresent',

        text: 'done',

        match: 'contains',

        caseSensitive: false,
      },
    },

    risk: {
      summaryRisk: 'READ_ONLY',

      maxStepRisk: 'READ_ONLY',

      requiresHumanByDefault: false,

      runtimePolicyRequired: true,
    },

    provenance: {
      discoveryRunId: 'run-1',

      compiledAt: '2026-09-20T21:00:00.000Z',

      compilerVersion: '1',

      sourceGoal: 'Lookup savings balance.',
    },
  };
}

describe('replay cli', () => {
  it('parses the documented replay command arguments', () => {
    const result = parseReplayCliArgs([
      '--capability',
      'lookup_savings_balance',

      '--version',
      '1.0.0',

      '--input',
      '{"memberName":"Alex Morgan"}',

      '--headed',

      '--synthetic-screenshots',
    ]);

    expect(result).toEqual({
      capability: 'lookup_savings_balance',

      version: '1.0.0',

      input: {
        memberName: 'Alex Morgan',
      },

      headed: true,

      syntheticScreenshots: true,
    });
  });

  it('requires capability', () => {
    expect(() => parseReplayCliArgs(['--version', '1.0.0', '--input', '{}'])).toThrow(
      '--capability is required',
    );
  });

  it('requires version', () => {
    expect(() =>
      parseReplayCliArgs(['--capability', 'lookup_savings_balance', '--input', '{}']),
    ).toThrow('--version is required');
  });

  it('requires input', () => {
    expect(() =>
      parseReplayCliArgs(['--capability', 'lookup_savings_balance', '--version', '1.0.0']),
    ).toThrow('--input is required');
  });

  it('rejects malformed input JSON', () => {
    expect(() =>
      parseReplayCliArgs([
        '--capability',
        'lookup_savings_balance',

        '--version',
        '1.0.0',

        '--input',
        '{bad',
      ]),
    ).toThrow('--input must contain valid JSON');
  });

  it('rejects unknown options', () => {
    expect(() =>
      parseReplayCliArgs([
        '--capability',
        'lookup_savings_balance',

        '--version',
        '1.0.0',

        '--input',
        '{}',

        '--unknown',
      ]),
    ).toThrow('Unknown replay option "--unknown"');
  });

  it('keeps business logic outside the CLI', async () => {
    const loadArtifact = vi.fn(() => Promise.resolve(artifact()));

    const validateInputs = vi.fn(() => ({
      memberName: 'Alex Morgan',
    }));

    const runReplay = vi.fn<ReplayCliDependencies['runReplay']>(() =>
      Promise.resolve({
        result: {
          runId: 'run-1',

          sessionId: 'session-1',

          startedAt: '2026-09-20T21:00:00.000Z',

          finishedAt: '2026-09-20T21:00:01.000Z',

          durationMs: 1_000,

          evidenceRefs: [],

          recoverableConditions: [],

          status: 'success',

          outputs: {
            savingsBalance: '$12,840.50',
          },
        },

        evidenceLocation: 'evidence/run-1',
      }),
    );

    const stdout = vi.fn();

    const stderr = vi.fn();

    const result = await runReplayCli(
      [
        '--capability',
        'lookup_savings_balance',

        '--version',
        '1.0.0',

        '--input',
        '{"memberName":"Alex Morgan"}',
      ],

      {
        loadArtifact,
        validateInputs,
        runReplay,
      },

      {
        stdout,
        stderr,
      },
    );

    expect(loadArtifact).toHaveBeenCalledWith('lookup_savings_balance', '1.0.0');

    expect(validateInputs).toHaveBeenCalledTimes(1);

    expect(runReplay).toHaveBeenCalledTimes(1);

    expect(result.exitCode).toBe(0);

    expect(stderr).not.toHaveBeenCalled();

    expect(stdout).toHaveBeenCalledTimes(1);
  });

  it('returns non-zero exit code for a replay failure result', async () => {
    const stdout = vi.fn();

    const stderr = vi.fn();

    const result = await runReplayCli(
      ['--capability', 'lookup_savings_balance', '--version', '1.0.0', '--input', '{}'],

      {
        loadArtifact: () => Promise.resolve(artifact()),

        validateInputs: () => ({}),

        runReplay: () =>
          Promise.resolve({
            result: {
              runId: 'run-1',

              sessionId: 'session-1',

              startedAt: '2026-09-20T21:00:00.000Z',

              finishedAt: '2026-09-20T21:00:01.000Z',

              durationMs: 1_000,

              evidenceRefs: [],

              recoverableConditions: [],

              status: 'failure',

              error: {
                code: 'ACTION_FAILED',

                message: 'Replay failed.',

                stepId: 'step-1',

                expected: null,

                observed: null,

                details: {},
              },
            },

            evidenceLocation: 'evidence/run-1',
          }),
      },

      {
        stdout,
        stderr,
      },
    );

    expect(result.exitCode).toBe(1);

    expect(stdout).toHaveBeenCalledTimes(1);
  });
});
