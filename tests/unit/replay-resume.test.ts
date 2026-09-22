import { describe, expect, it, vi } from 'vitest';

import { resolveReplayResume } from '../../src/replay/replay-resume.js';

import type { CapabilityStep } from '../../src/artifact/index.js';

import type { SurfaceObservation } from '../../src/surface/index.js';

const step: CapabilityStep = {
  id: 'confirm-create',

  description: 'Confirm Create Sub-Account',

  action: {
    kind: 'click',
  },

  risk: 'IRREVERSIBLE',

  target: {
    description: 'Confirm Create Sub-Account button',

    strategies: [
      {
        kind: 'role-name',
        role: 'button',
        name: {
          value: 'Confirm Create Sub-Account',
          mode: 'exact',
          caseSensitive: false,
        },
      },
    ],

    cardinality: 'exactly-one',
  },

  postconditions: [
    {
      kind: 'textPresent',
      text: 'Sub-account created',
      match: 'contains',
      caseSensitive: false,
    },
  ],
};

function observation(observationId: string, visibleText: string): SurfaceObservation {
  return {
    sessionId: 'session-resume',
    surfaceId: 'surface-resume',
    observationId,
    capturedAt: '2026-09-22T17:30:00.000Z',

    location: {
      kind: 'web',
      url: 'http://localhost:3000/member/12345/subaccounts',
      title: 'Sub-Accounts',
    },

    visibleText,
    controls: [],
    dialogs: [],
    loading: 'complete',

    truncated: {
      visibleText: false,
      controls: false,
    },
  };
}

describe('replay resume contract', () => {
  it('always observes fresh state before deciding continuation', async () => {
    const order: string[] = [];

    const observeFresh = vi.fn(() => {
      order.push('observe');

      return Promise.resolve(observation('observation-after-human', 'Sub-account created'));
    });

    const evaluate = vi.fn((current: SurfaceObservation) => {
      order.push('postcondition');

      expect(current.observationId).toBe('observation-after-human');

      return Promise.resolve({
        status: 'passed' as const,
      });
    });

    const result = await resolveReplayResume({
      step,
      stepIndex: 4,

      staleObservationId: 'observation-before-human',

      observeFresh,

      evaluatePausedStepPostconditions: evaluate,
    });

    expect(order).toEqual(['observe', 'postcondition']);

    expect(observeFresh).toHaveBeenCalledTimes(1);

    expect(result).toEqual({
      status: 'manual_step_resolved',

      stepId: 'confirm-create',

      resumedFromStepIndex: 4,

      continueAtStepIndex: 5,

      freshObservationId: 'observation-after-human',
    });
  });

  it('does not rerun the paused irreversible action when the human already satisfied the postcondition', async () => {
    const executePausedAction = vi.fn();

    const result = await resolveReplayResume({
      step,
      stepIndex: 4,

      staleObservationId: 'observation-before-human',

      observeFresh: () =>
        Promise.resolve(observation('observation-after-human', 'Sub-account created')),

      evaluatePausedStepPostconditions: () =>
        Promise.resolve({
          status: 'passed',
        }),
    });

    /*
     * resolveReplayResume has no action callback by design.
     * The caller receives only the next deterministic index.
     */
    expect(executePausedAction).not.toHaveBeenCalled();

    expect(result).toMatchObject({
      status: 'manual_step_resolved',

      continueAtStepIndex: 5,
    });
  });

  it('stops instead of retrying when the human action did not satisfy the paused-step postcondition', async () => {
    const result = await resolveReplayResume({
      step,
      stepIndex: 4,

      staleObservationId: 'observation-before-human',

      observeFresh: () =>
        Promise.resolve(observation('observation-after-human', 'Review Sub-Account')),

      evaluatePausedStepPostconditions: () =>
        Promise.resolve({
          status: 'not_satisfied',

          reason: 'Creation success message is absent',

          details: {
            expected: 'Sub-account created',
            observed: 'Review Sub-Account',
          },
        }),
    });

    expect(result).toMatchObject({
      status: 'intervention_required',

      reasonCode: 'RECOVERY_EXHAUSTED',

      stepId: 'confirm-create',

      freshObservationId: 'observation-after-human',

      details: {
        reason: 'HUMAN_ACTION_POSTCONDITION_NOT_SATISFIED',
      },
    });
  });

  it('rejects accidental reuse of the stale pre-human observation', async () => {
    const evaluate = vi.fn();

    const result = await resolveReplayResume({
      step,
      stepIndex: 4,

      staleObservationId: 'observation-before-human',

      observeFresh: () =>
        Promise.resolve(observation('observation-before-human', 'Review Sub-Account')),

      evaluatePausedStepPostconditions: evaluate,
    });

    expect(result).toMatchObject({
      status: 'failure',

      code: 'ACTION_FAILED',

      stepId: 'confirm-create',

      details: {
        reason: 'STALE_RESUME_OBSERVATION',
      },
    });

    expect(evaluate).not.toHaveBeenCalled();
  });

  it('fails closed for an invalid paused step index', async () => {
    const observeFresh = vi.fn();

    const result = await resolveReplayResume({
      step,

      stepIndex: -1,

      observeFresh,

      evaluatePausedStepPostconditions: () =>
        Promise.resolve({
          status: 'passed',
        }),
    });

    expect(result).toMatchObject({
      status: 'failure',

      code: 'ACTION_FAILED',

      details: {
        reason: 'INVALID_RESUME_STEP_INDEX',
      },
    });

    expect(observeFresh).not.toHaveBeenCalled();
  });
});
