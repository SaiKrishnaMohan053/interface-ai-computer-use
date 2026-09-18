import { describe, expect, it } from 'vitest';

import { extractSuccessfulDiscoveryPath } from '../../src/artifact/index.js';

import type { AgentTargetSpec, DiscoveryTraceRecord } from '../../src/discovery/index.js';

function target(): AgentTargetSpec {
  return {
    description: 'Search button',
    strategies: [
      {
        kind: 'role-name',
        role: 'button',
        name: {
          value: 'Search',
          mode: 'exact',
          caseSensitive: false,
        },
      },
    ],
    cardinality: 'exactly-one',
  };
}

function allowPolicy(step: number, actionKind: 'click' | 'wait' | 'read'): DiscoveryTraceRecord {
  return {
    kind: 'policy_decision',
    step,
    actionKind,
    systemRiskLevel: 'READ_ONLY',
    policyDecision: {
      policyId: 'default',
      matchedRuleId: null,
      reason: 'Allowed for test.',
      decision: 'ALLOW',
      riskLevel: 'READ_ONLY',
    },
  };
}

describe('extractSuccessfulDiscoveryPath', () => {
  it('includes successful reusable UI actions', () => {
    const trace: DiscoveryTraceRecord[] = [
      {
        kind: 'model_decision',
        step: 1,
        decision: {
          kind: 'click',
          target: target(),
          reason: 'Submit search.',
        },
        rationale: 'Submit search.',
      },
      allowPolicy(1, 'click'),
      {
        kind: 'action_result',
        step: 1,
        actionKind: 'click',
        status: 'success',
        errorCode: null,
        extractedValues: {},
        evidenceRefs: [],
      },
    ];

    const result = extractSuccessfulDiscoveryPath(trace);

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({
      sourceStep: 1,
      decision: {
        kind: 'click',
      },
      risk: 'READ_ONLY',
    });
  });

  it('excludes observations, policy logs, target logs, condition logs and runtime events', () => {
    const trace: DiscoveryTraceRecord[] = [
      {
        kind: 'observation',
        step: 1,
        observationId: 'obs-1',
        location: {
          kind: 'web',
          url: 'http://localhost/',
          title: 'Demo',
        },
        summary: 'Visible page',
        loading: 'complete',
        controlCount: 1,
        dialogCount: 0,
        evidenceRefs: [],
      },
      {
        kind: 'runtime_event',
        step: 1,
        status: 'success',
        summary: 'Done',
      },
    ];

    const result = extractSuccessfulDiscoveryPath(trace);

    expect(result.actions).toEqual([]);
    expect(result.discarded).toHaveLength(2);
  });

  it('excludes failed action attempts', () => {
    const trace: DiscoveryTraceRecord[] = [
      {
        kind: 'model_decision',
        step: 1,
        decision: {
          kind: 'click',
          target: target(),
          reason: 'Try search.',
        },
        rationale: 'Try search.',
      },
      allowPolicy(1, 'click'),
      {
        kind: 'action_result',
        step: 1,
        actionKind: 'click',
        status: 'failure',
        errorCode: 'TARGET_NOT_FOUND',
        extractedValues: {},
        evidenceRefs: [],
      },
    ];

    const result = extractSuccessfulDiscoveryPath(trace);

    expect(result.actions).toEqual([]);

    expect(
      result.discarded.some((record) => record.step === 1 && record.reason === 'FAILED_ACTION'),
    ).toBe(true);
  });

  it('keeps the later successful retry but not the failed attempt', () => {
    const trace: DiscoveryTraceRecord[] = [
      {
        kind: 'model_decision',
        step: 1,
        decision: {
          kind: 'click',
          target: target(),
          reason: 'First attempt.',
        },
        rationale: 'First attempt.',
      },
      allowPolicy(1, 'click'),
      {
        kind: 'action_result',
        step: 1,
        actionKind: 'click',
        status: 'failure',
        errorCode: 'TARGET_NOT_FOUND',
        extractedValues: {},
        evidenceRefs: [],
      },

      {
        kind: 'model_decision',
        step: 2,
        decision: {
          kind: 'click',
          target: target(),
          reason: 'Retry.',
        },
        rationale: 'Retry.',
      },
      allowPolicy(2, 'click'),
      {
        kind: 'action_result',
        step: 2,
        actionKind: 'click',
        status: 'success',
        errorCode: null,
        extractedValues: {},
        evidenceRefs: [],
      },
    ];

    const result = extractSuccessfulDiscoveryPath(trace);

    expect(result.actions.map((action) => action.sourceStep)).toEqual([2]);
  });

  it('excludes complete and escalate control decisions', () => {
    const trace: DiscoveryTraceRecord[] = [
      {
        kind: 'model_decision',
        step: 1,
        decision: {
          kind: 'complete',
          summary: 'Done.',
          outputs: {},
        },
        rationale: 'Done.',
      },
      {
        kind: 'model_decision',
        step: 2,
        decision: {
          kind: 'escalate',
          reasonCode: 'AUTOMATION_STUCK',
          reason: 'Need help.',
        },
        rationale: 'Need help.',
      },
    ];

    const result = extractSuccessfulDiscoveryPath(trace);

    expect(result.actions).toEqual([]);

    expect(
      result.discarded.filter((record) => record.reason === 'MODEL_CONTROL_DECISION'),
    ).toHaveLength(2);
  });

  it('preserves intentional successful waits', () => {
    const trace: DiscoveryTraceRecord[] = [
      {
        kind: 'model_decision',
        step: 3,
        decision: {
          kind: 'wait',
          condition: {
            kind: 'loadingComplete',
          },
          reason: 'Wait for loading.',
        },
        rationale: 'Wait for loading.',
      },
      allowPolicy(3, 'wait'),
      {
        kind: 'action_result',
        step: 3,
        actionKind: 'wait',
        status: 'success',
        errorCode: null,
        extractedValues: {},
        evidenceRefs: [],
      },
    ];

    const result = extractSuccessfulDiscoveryPath(trace);

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]?.decision.kind).toBe('wait');
  });

  it('preserves successful read actions', () => {
    const trace: DiscoveryTraceRecord[] = [
      {
        kind: 'model_decision',
        step: 4,
        decision: {
          kind: 'read',
          target: target(),
          source: 'text',
          saveAs: 'balance',
          reason: 'Read balance.',
        },
        rationale: 'Read balance.',
      },
      allowPolicy(4, 'read'),
      {
        kind: 'action_result',
        step: 4,
        actionKind: 'read',
        status: 'success',
        errorCode: null,
        extractedValues: {
          balance: '$100.00',
        },
        evidenceRefs: [],
      },
    ];

    const result = extractSuccessfulDiscoveryPath(trace);

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]?.decision.kind).toBe('read');
  });
});
