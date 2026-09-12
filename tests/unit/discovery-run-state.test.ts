import { describe, expect, it } from 'vitest';

import {
  appendDiscoveryStep,
  createDiscoveryRunState,
  parseDiscoveryDecision,
  parseDiscoveryRequest,
  recordDiscoveryObservationFingerprint,
  resolveDiscoveryRunConfig,
} from '../../src/discovery/index.js';

import type { DiscoveryRunState, DiscoveryStepRecord } from '../../src/discovery/index.js';

function state(): DiscoveryRunState {
  const request = parseDiscoveryRequest({
    goal: "Read Alex Morgan's Savings balance",
    target: {
      application: 'Demo Bank',
      entryUrl: 'https://bank.test/member-search',
    },
  });

  return createDiscoveryRunState({
    runId: 'run-1',
    request,
    config: resolveDiscoveryRunConfig(request),
    startedAt: '2026-09-11T19:00:00.000Z',
    deadlineAt: '2026-09-11T19:02:00.000Z',
  });
}

function step(stepNumber: number): DiscoveryStepRecord {
  return {
    step: stepNumber,
    observationId: `observation-${stepNumber}`,
    observationFingerprint: `fingerprint-${stepNumber}`,
    decision: parseDiscoveryDecision({
      kind: 'escalate',
      reasonCode: 'AUTOMATION_STUCK',
      reason: 'Test step',
    }),
    outcome: 'decision_recorded',
  };
}

describe('DiscoveryRunState', () => {
  it('creates empty working memory for one active run', () => {
    expect(state()).toMatchObject({
      runId: 'run-1',
      step: 0,
      lastObservationFingerprint: null,
      repeatedStateCount: 0,
      extractedValues: {},
      extractions: [],
      recentSteps: [],
    });
  });

  it('does not share mutable working memory between runs', () => {
    const first = state();
    const second = state();

    first.extractedValues.balance = '$12,840.50';
    first.recentSteps.push(step(1));

    expect(second.extractedValues).toEqual({});
    expect(second.recentSteps).toEqual([]);
  });

  it('counts only consecutive repeated observation fingerprints', () => {
    const run = state();

    expect(recordDiscoveryObservationFingerprint(run, 'same')).toBe(1);
    expect(recordDiscoveryObservationFingerprint(run, 'same')).toBe(2);
    expect(recordDiscoveryObservationFingerprint(run, 'different')).toBe(1);

    expect(run.lastObservationFingerprint).toBe('different');
  });

  it('keeps recent steps within the requested bounded window', () => {
    const run = state();

    for (let current = 1; current <= 5; current += 1) {
      appendDiscoveryStep(run, step(current), 3);
    }

    expect(run.recentSteps.map((record) => record.step)).toEqual([3, 4, 5]);
  });

  it.each([0, -1, 1.5, 101])('rejects invalid recent-step limit %s', (limit) => {
    expect(() => appendDiscoveryStep(state(), step(1), limit)).toThrow(RangeError);
  });
});
