import { describe, expect, it, vi } from 'vitest';

import { continueDiscoveryAfterHuman } from '../../src/discovery/index.js';

import type { CoordinatedRunContext } from '../../src/runtime/index.js';

import type { SessionManager } from '../../src/session/index.js';

import type { SurfaceObservation } from '../../src/surface/index.js';

import type { TargetStrategy } from '../../src/targeting/index.js';

import type { AgentObservation } from '../../src/discovery/index.js';

class FakeSessionManager {
  state: 'ACTIVE' | 'PAUSED' = 'ACTIVE';

  owner: 'DISCOVERY' | 'HUMAN' = 'DISCOVERY';

  snapshot() {
    return {
      sessionId: 'session-discovery-resume',

      state: this.state,

      owner: this.owner,

      failureReason: null,
    } as const;
  }
}

function context(session: FakeSessionManager): CoordinatedRunContext<TargetStrategy> {
  return {
    runId: 'run-discovery-resume',

    mode: 'DISCOVERY',

    sessionManager: session as unknown as SessionManager,
  } as unknown as CoordinatedRunContext<TargetStrategy>;
}

function observation(id: string, text: string): SurfaceObservation {
  return {
    sessionId: 'session-discovery-resume',

    surfaceId: 'surface-1',

    observationId: id,

    capturedAt: '2026-09-22T18:00:00.000Z',

    location: {
      kind: 'web',

      url: 'http://localhost:3000/member/12345/accounts',

      title: 'Accounts',
    },

    visibleText: text,

    controls: [],

    dialogs: [],

    loading: 'complete',

    truncated: {
      visibleText: false,
      controls: false,
    },
  };
}

describe('discovery resume after human handoff', () => {
  it('re-observes and gives the model only the fresh sanitized observation', async () => {
    const session = new FakeSessionManager();

    const order: string[] = [];

    const observeFresh = vi.fn(() => {
      order.push('observe');

      return Promise.resolve(
        observation('observation-after-human', 'Accounts page after human resolved the dialog'),
      );
    });

    const decide = vi.fn((agentObservation: AgentObservation) => {
      order.push('model');

      expect(agentObservation.observationId).toBe('observation-after-human');

      expect(agentObservation.visibleTextSummary).toContain(
        'Accounts page after human resolved the dialog',
      );

      return Promise.resolve({
        kind: 'complete' as const,

        summary: 'Human resolved the blocked state and discovery can complete.',

        outputs: {},
      });
    });

    const result = await continueDiscoveryAfterHuman({
      context: context(session),

      goal: 'Inspect member accounts',

      step: 6,

      staleObservationId: 'observation-before-human',

      observeFresh,

      decideWithFreshObservation: decide,
    });

    expect(order).toEqual(['observe', 'model']);

    expect(result.status).toBe('continued');

    expect(observeFresh).toHaveBeenCalledTimes(1);

    expect(decide).toHaveBeenCalledTimes(1);
  });

  it('rejects the stale pre-human observation before the model is called', async () => {
    const session = new FakeSessionManager();

    const decide = vi.fn();

    const result = await continueDiscoveryAfterHuman({
      context: context(session),

      goal: 'Inspect member accounts',

      step: 6,

      staleObservationId: 'observation-before-human',

      observeFresh: () =>
        Promise.resolve(observation('observation-before-human', 'Old blocked state')),

      decideWithFreshObservation: decide,
    });

    expect(result).toMatchObject({
      status: 'failure',

      code: 'ACTION_FAILED',

      details: {
        reason: 'STALE_DISCOVERY_RESUME_OBSERVATION',
      },
    });

    expect(decide).not.toHaveBeenCalled();
  });

  it('does not observe or call the model until DISCOVERY ownership is active again', async () => {
    const session = new FakeSessionManager();

    session.state = 'PAUSED';
    session.owner = 'HUMAN';

    const observeFresh = vi.fn();

    const decide = vi.fn();

    const result = await continueDiscoveryAfterHuman({
      context: context(session),

      goal: 'Inspect member accounts',

      step: 6,

      observeFresh: observeFresh as () => Promise<SurfaceObservation>,

      decideWithFreshObservation: decide,
    });

    expect(result).toMatchObject({
      status: 'failure',

      code: 'ACTION_FAILED',

      details: {
        reason: 'DISCOVERY_OWNERSHIP_NOT_RESTORED',
      },
    });

    expect(observeFresh).not.toHaveBeenCalled();

    expect(decide).not.toHaveBeenCalled();
  });
});
