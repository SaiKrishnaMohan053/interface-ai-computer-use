import { describe, expect, it } from 'vitest';

import {
  DiscoveryDecisionValidationError,
  requestValidatedDiscoveryDecision,
} from '../../src/discovery/index.js';

import type {
  DiscoveryDecision,
  DiscoveryDecisionModel,
  DiscoveryModelInput,
} from '../../src/discovery/index.js';

const modelInput = {} as DiscoveryModelInput;

class SequenceModel implements DiscoveryDecisionModel {
  calls = 0;

  constructor(private readonly responses: readonly unknown[]) {}

  decide(): Promise<DiscoveryDecision> {
    const response = this.responses[this.calls];

    this.calls += 1;

    return Promise.resolve(response as DiscoveryDecision);
  }
}

const escalation: DiscoveryDecision = {
  kind: 'escalate',
  reasonCode: 'AUTOMATION_STUCK',
  reason: 'No safe progress is available',
};

describe('discovery model decision validation', () => {
  it('returns a valid first response without retrying', async () => {
    const model = new SequenceModel([escalation]);

    await expect(
      requestValidatedDiscoveryDecision({
        model,
        modelInput,
      }),
    ).resolves.toEqual({
      decision: escalation,
      attempts: 1,
    });

    expect(model.calls).toBe(1);
  });

  it('retries one invalid structured response and accepts the correction', async () => {
    const model = new SequenceModel([{ kind: 'unsupported' }, escalation]);

    const invalidAttempts: Array<{
      attempt: number;
      issues: readonly string[];
    }> = [];

    await expect(
      requestValidatedDiscoveryDecision({
        model,
        modelInput,
        onInvalid: (invalid) => {
          invalidAttempts.push(invalid);
        },
      }),
    ).resolves.toEqual({
      decision: escalation,
      attempts: 2,
    });

    expect(model.calls).toBe(2);

    expect(invalidAttempts).toMatchObject([
      {
        attempt: 1,
      },
    ]);

    expect(invalidAttempts[0]?.issues.length).toBeGreaterThan(0);
  });

  it('fails clearly after the format retry is exhausted', async () => {
    const model = new SequenceModel([
      {
        kind: 'click',
        reason: 'Missing target',
      },
      {
        kind: 'read',
        saveAs: 'balance',
      },
    ]);

    const result = requestValidatedDiscoveryDecision({
      model,
      modelInput,
    });

    await expect(result).rejects.toMatchObject({
      name: 'DiscoveryDecisionValidationError',
      code: 'MODEL_DECISION_VALIDATION_FAILED',
      attempts: 2,
    });

    await expect(result).rejects.toBeInstanceOf(DiscoveryDecisionValidationError);

    expect(model.calls).toBe(2);
  });

  it('does not retry non-validation model failures', async () => {
    const model: DiscoveryDecisionModel = {
      decide: () => Promise.reject(new Error('transport unavailable')),
    };

    await expect(
      requestValidatedDiscoveryDecision({
        model,
        modelInput,
      }),
    ).rejects.toThrow('transport unavailable');
  });

  it.each([-1, 1.5, 4])('rejects invalid retry limit %s', async (maxFormatRetries) => {
    await expect(
      requestValidatedDiscoveryDecision({
        model: new SequenceModel([escalation]),
        modelInput,
        maxFormatRetries,
      }),
    ).rejects.toBeInstanceOf(RangeError);
  });
});
