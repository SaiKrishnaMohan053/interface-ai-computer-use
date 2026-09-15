import { describe, expect, it } from 'vitest';

import type { DiscoveryDecision, DiscoveryModelInput } from '../../src/discovery/index.js';

import {
  ScriptedDiscoveryDecisionModel,
  ScriptedDiscoveryModelExhaustedError,
} from '../helpers/scripted-discovery-model.js';

const input = {} as DiscoveryModelInput;

const decisions: readonly DiscoveryDecision[] = [
  {
    kind: 'wait',
    condition: {
      kind: 'loadingComplete',
    },
    reason: 'Wait for the application',
  },
  {
    kind: 'escalate',
    reasonCode: 'AUTOMATION_STUCK',
    reason: 'No safe progress remains',
  },
];

describe('ScriptedDiscoveryDecisionModel', () => {
  it('returns predetermined typed decisions in order and captures inputs', async () => {
    const model = new ScriptedDiscoveryDecisionModel(decisions);

    await expect(model.decide(input)).resolves.toEqual(decisions[0]);

    await expect(model.decide(input)).resolves.toEqual(decisions[1]);

    expect(model.inputs).toEqual([input, input]);
    expect(model.calls).toBe(2);
    expect(model.remaining).toBe(0);
  });

  it('fails explicitly when the script is exhausted', async () => {
    const model = new ScriptedDiscoveryDecisionModel([decisions[0]!]);

    await model.decide(input);

    await expect(model.decide(input)).rejects.toMatchObject({
      name: 'ScriptedDiscoveryModelExhaustedError',
      requestedCall: 2,
    });

    await expect(model.decide(input)).rejects.toBeInstanceOf(ScriptedDiscoveryModelExhaustedError);
  });

  it('validates every scripted decision at construction', () => {
    expect(
      () =>
        new ScriptedDiscoveryDecisionModel([
          {
            kind: 'click',
            reason: 'Missing target',
          } as DiscoveryDecision,
        ]),
    ).toThrow();
  });
});
