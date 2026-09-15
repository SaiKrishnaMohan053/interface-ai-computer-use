import { describe, expect, it, vi } from 'vitest';

import {
  DiscoveryModelRequestError,
  DiscoveryModelResponseError,
  OpenAIDiscoveryDecisionModel,
  parseAgentObservation,
} from '../../src/discovery/index.js';

import type {
  DiscoveryModelInput,
  OpenAIDecisionTransport,
  OpenAIDiscoveryModelConfig,
} from '../../src/discovery/index.js';

const secret = 'sk-test-secret-must-not-be-logged';

const config: OpenAIDiscoveryModelConfig = {
  apiKey: secret,
  model: 'gpt-4.1-mini',
  timeoutMs: 30_000,
  maxRetries: 0,
  maxOutputTokens: 4_096,
};

const modelInput: DiscoveryModelInput = {
  observation: parseAgentObservation({
    goal: "Read Alex Morgan's Savings balance",
    step: 4,

    observationId: 'observation-4',
    capturedAt: '2026-09-11T15:00:00.000Z',

    location: {
      kind: 'web',
      url: 'https://bank.test/member/alex/accounts',
      title: 'Alex Morgan Accounts',
    },

    visibleTextSummary: 'Alex Morgan\nAccounts\nSavings\nCurrent Balance\n$12,840.50',

    controls: [],
    dialogs: [],

    contextHints: {
      frames: ['Top-level document'],
      regions: ['Accounts table'],
    },

    loading: 'complete',

    truncated: {
      visibleText: false,
      controls: false,
    },

    extractedValues: {
      savingsBalance: '$12,840.50',
    },

    recentAction: null,
    recentCondition: null,
    recentError: null,
  }),
};

function modelReturning(response: unknown): OpenAIDiscoveryDecisionModel {
  const transport: OpenAIDecisionTransport = () => Promise.resolve(response);

  return new OpenAIDiscoveryDecisionModel(config, transport);
}

describe('OpenAI discovery model adapter', () => {
  it('parses a valid structured action decision', async () => {
    const decision = {
      kind: 'click',
      target: {
        description: 'Accounts link',
        strategies: [
          {
            kind: 'role-name',
            role: 'link',
            name: {
              value: 'Accounts',
              mode: 'exact',
              caseSensitive: false,
            },
          },
        ],
        cardinality: 'exactly-one',
      },
      reason: 'Open the observed accounts page',
    };

    await expect(modelReturning(decision).decide(modelInput)).resolves.toEqual(decision);
  });

  it('rejects an invalid structured model decision', async () => {
    await expect(
      modelReturning({
        kind: 'click',
        reason: 'Missing target',
      }).decide(modelInput),
    ).rejects.toBeInstanceOf(DiscoveryModelResponseError);
  });

  it('parses a complete decision', async () => {
    const decision = {
      kind: 'complete',
      summary: 'Savings balance was read from the observed account table',
      outputs: {
        savingsBalance: '$12,840.50',
      },
    };

    await expect(modelReturning(decision).decide(modelInput)).resolves.toEqual(decision);
  });

  it('parses an escalate decision', async () => {
    const decision = {
      kind: 'escalate',
      reasonCode: 'AUTOMATION_STUCK',
      reason: 'Unable to identify a unique target safely',
    };

    await expect(modelReturning(decision).decide(modelInput)).resolves.toEqual(decision);
  });

  it('maps a provider failure to a typed model request error', async () => {
    const transport: OpenAIDecisionTransport = () =>
      Promise.reject(new Error('provider unavailable'));

    const model = new OpenAIDiscoveryDecisionModel(config, transport);

    await expect(model.decide(modelInput)).rejects.toMatchObject({
      name: 'DiscoveryModelRequestError',
      code: 'MODEL_REQUEST_FAILED',
      message: 'OpenAI discovery decision request failed',
    });

    await expect(model.decide(modelInput)).rejects.toBeInstanceOf(DiscoveryModelRequestError);
  });

  it('does not send or log the API key through the adapter boundary', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    let serializedRequest = '';

    const transport: OpenAIDecisionTransport = (request) => {
      serializedRequest = JSON.stringify(request);

      return Promise.reject(new Error(`provider rejected credential ${secret}`));
    };

    const model = new OpenAIDiscoveryDecisionModel(config, transport);

    try {
      await expect(model.decide(modelInput)).rejects.toMatchObject({
        message: 'OpenAI discovery decision request failed',
      });

      expect(serializedRequest).not.toContain(secret);

      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });
});
