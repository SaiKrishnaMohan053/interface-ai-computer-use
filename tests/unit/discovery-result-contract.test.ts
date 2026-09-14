import { describe, expect, it } from 'vitest';

import { parseDiscoveryRunResult, withDiscoverySteps } from '../../src/discovery/index.js';

import { parseRuntimeResult } from '../../src/runtime/index.js';

const base = {
  runId: 'run-1',
  sessionId: 'session-1',
  startedAt: '2026-09-14T18:00:00.000Z',
  finishedAt: '2026-09-14T18:00:01.000Z',
  durationMs: 1_000,
  evidenceRefs: [],
  recoverableConditions: [],
  steps: 2,
};

describe('DiscoveryRunResult', () => {
  it('accepts structured success with bounded steps', () => {
    expect(
      parseDiscoveryRunResult({
        ...base,
        status: 'success',
        outputs: {
          savingsBalance: '$12,840.50',
        },
      }),
    ).toMatchObject({
      status: 'success',
      runId: 'run-1',
      steps: 2,
      outputs: {
        savingsBalance: '$12,840.50',
      },
    });
  });

  it('accepts intervention, business outcome, and failure', () => {
    expect(
      parseDiscoveryRunResult({
        ...base,
        status: 'intervention_required',
        intervention: {
          interventionId: 'intervention-1',
          code: 'AUTOMATION_STUCK',
          message: 'Unable to identify a unique target safely',
          requestedOwner: 'HUMAN',
          resumable: false,
          context: {
            source: 'target_resolver',
          },
        },
      }).status,
    ).toBe('intervention_required');

    expect(
      parseDiscoveryRunResult({
        ...base,
        status: 'business_outcome',
        outcome: {
          code: 'PERMISSION_DENIED',
          message: 'Access is restricted',
          details: {
            step: 2,
          },
        },
      }).status,
    ).toBe('business_outcome');

    expect(
      parseDiscoveryRunResult({
        ...base,
        status: 'failure',
        error: {
          code: 'ACTION_FAILED',
          message: 'Action failed',
          stepId: '2',
          expected: 'successful action',
          observed: 'failure',
          details: {
            phase: 'discovery_loop',
          },
        },
      }).status,
    ).toBe('failure');
  });

  it('adds steps to a validated runtime result', () => {
    const runtime = parseRuntimeResult({
      runId: base.runId,
      sessionId: base.sessionId,
      startedAt: base.startedAt,
      finishedAt: base.finishedAt,
      durationMs: base.durationMs,
      evidenceRefs: [],
      recoverableConditions: [],
      status: 'success',
      outputs: {
        savingsBalance: '$12,840.50',
      },
    });

    expect(withDiscoverySteps(runtime, 4)).toMatchObject({
      status: 'success',
      steps: 4,
    });
  });

  it.each([-1, 1.5, 101])('rejects invalid step count %s', (steps) => {
    expect(() =>
      parseDiscoveryRunResult({
        ...base,
        steps,
        status: 'success',
        outputs: {},
      }),
    ).toThrow();
  });

  it('rejects provider responses and chain-of-thought fields', () => {
    expect(() =>
      parseDiscoveryRunResult({
        ...base,
        status: 'success',
        outputs: {
          savingsBalance: '$12,840.50',
        },
        rawOpenAIResponse: {
          id: 'response-1',
        },
      }),
    ).toThrow();

    expect(() =>
      parseDiscoveryRunResult({
        ...base,
        status: 'success',
        outputs: {
          savingsBalance: '$12,840.50',
        },
        chainOfThought: 'hidden reasoning',
      }),
    ).toThrow();
  });
});
