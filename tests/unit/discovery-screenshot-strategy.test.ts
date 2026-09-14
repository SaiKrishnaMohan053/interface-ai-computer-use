import { describe, expect, it } from 'vitest';

import { planDiscoveryObservationScreenshot } from '../../src/discovery/index.js';

describe('Discovery screenshot strategy', () => {
  it('keeps screenshot persistence disabled by default policy', () => {
    expect(
      planDiscoveryObservationScreenshot({
        evidenceMode: 'none',
        step: 1,
      }),
    ).toBeNull();
  });

  it('marks the first structured observation as the initial state', () => {
    expect(
      planDiscoveryObservationScreenshot({
        evidenceMode: 'synthetic_fixture',
        step: 1,
      }),
    ).toEqual({
      purpose: 'initial_state',
      extent: 'viewport',
      dataHandling: 'SYNTHETIC_FIXTURE_ONLY',
    });
  });

  it('marks the state after navigation as a transition', () => {
    expect(
      planDiscoveryObservationScreenshot({
        evidenceMode: 'synthetic_fixture',
        step: 2,
        recentActionKind: 'navigate',
      }),
    ).toMatchObject({
      purpose: 'navigation_transition',
    });
  });

  it('captures other observations as bounded discovery steps', () => {
    expect(
      planDiscoveryObservationScreenshot({
        evidenceMode: 'synthetic_fixture',
        step: 3,
        recentActionKind: 'read',
      }),
    ).toMatchObject({
      purpose: 'step_observation',
    });
  });

  it('rejects invalid capture steps', () => {
    expect(() =>
      planDiscoveryObservationScreenshot({
        evidenceMode: 'synthetic_fixture',
        step: 0,
      }),
    ).toThrow('positive integer');
  });
});
