import { describe, expect, it } from 'vitest';

import {
  DiscoveryModelResponseError,
  OpenAIDiscoveryDecisionModel,
  loadOpenAIDiscoveryModelConfig,
  parseAgentObservation,
} from '../../src/discovery/index.js';

import type {
  DiscoveryDecisionModel,
  DiscoveryModelInput,
  OpenAIDecisionTransport,
  OpenAIDecisionTransportRequest,
  OpenAIDiscoveryModelConfig,
} from '../../src/discovery/index.js';

const observation = parseAgentObservation({
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
});

const config: OpenAIDiscoveryModelConfig = {
  apiKey: 'test-key-never-sent-to-transport',
  model: 'gpt-4.1-mini',
  timeoutMs: 30_000,
  maxRetries: 2,
  maxOutputTokens: 4_096,
};

describe('OpenAI discovery model configuration', () => {
  it('loads configuration from environment variables', () => {
    expect(
      loadOpenAIDiscoveryModelConfig({
        OPENAI_API_KEY: 'test-api-key',
        OPENAI_MODEL: 'gpt-4.1-mini',
        OPENAI_TIMEOUT_MS: '45000',
        OPENAI_MAX_RETRIES: '3',
        OPENAI_MAX_OUTPUT_TOKENS: '8192',
      }),
    ).toEqual({
      apiKey: 'test-api-key',
      model: 'gpt-4.1-mini',
      timeoutMs: 45_000,
      maxRetries: 3,
      maxOutputTokens: 8_192,
    });
  });

  it('uses bounded defaults for optional settings', () => {
    expect(
      loadOpenAIDiscoveryModelConfig({
        OPENAI_API_KEY: 'test-api-key',
        OPENAI_MODEL: 'gpt-4.1-mini',
      }),
    ).toEqual({
      apiKey: 'test-api-key',
      model: 'gpt-4.1-mini',
      timeoutMs: 30_000,
      maxRetries: 2,
      maxOutputTokens: 4_096,
    });
  });

  it('rejects missing credentials and model selection', () => {
    expect(() => loadOpenAIDiscoveryModelConfig({})).toThrow();

    expect(() =>
      loadOpenAIDiscoveryModelConfig({
        OPENAI_API_KEY: ' ',
        OPENAI_MODEL: ' ',
      }),
    ).toThrow();
  });

  it('rejects invalid retry, timeout, and output-token settings', () => {
    expect(() =>
      loadOpenAIDiscoveryModelConfig({
        OPENAI_API_KEY: 'test-api-key',
        OPENAI_MODEL: 'gpt-4.1-mini',
        OPENAI_TIMEOUT_MS: '-1',
      }),
    ).toThrow();

    expect(() =>
      loadOpenAIDiscoveryModelConfig({
        OPENAI_API_KEY: 'test-api-key',
        OPENAI_MODEL: 'gpt-4.1-mini',
        OPENAI_MAX_RETRIES: '100',
      }),
    ).toThrow();

    expect(() =>
      loadOpenAIDiscoveryModelConfig({
        OPENAI_API_KEY: 'test-api-key',
        OPENAI_MODEL: 'gpt-4.1-mini',
        OPENAI_MAX_OUTPUT_TOKENS: '100',
      }),
    ).toThrow();
  });
});

describe('DiscoveryDecisionModel abstraction', () => {
  it('supports a deterministic fake without OpenAI', async () => {
    class DeterministicFakeModel implements DiscoveryDecisionModel {
      decide(input: DiscoveryModelInput): Promise<{
        kind: 'complete';
        summary: string;
        outputs: Record<string, string>;
      }> {
        return Promise.resolve({
          kind: 'complete',
          summary: `Completed step ${input.observation.step}`,
          outputs: {
            savingsBalance: '$12,840.50',
          },
        });
      }
    }

    const model: DiscoveryDecisionModel = new DeterministicFakeModel();

    await expect(
      model.decide({
        observation,
      }),
    ).resolves.toEqual({
      kind: 'complete',
      summary: 'Completed step 4',
      outputs: {
        savingsBalance: '$12,840.50',
      },
    });
  });
});

describe('OpenAIDiscoveryDecisionModel', () => {
  it('returns a domain decision without leaking SDK structures', async () => {
    let received: OpenAIDecisionTransportRequest | undefined;

    const transport: OpenAIDecisionTransport = (request) => {
      received = request;

      return Promise.resolve({
        decision: {
          kind: 'complete',
          argumentsJson: JSON.stringify({
            summary: "Located Alex Morgan's Savings account and read the balance.",
            outputs: {
              savingsBalance: '$12,840.50',
            },
          }),
        },
      });
    };

    const model = new OpenAIDiscoveryDecisionModel(config, transport);

    await expect(
      model.decide({
        observation,
      }),
    ).resolves.toEqual({
      kind: 'complete',
      summary: "Located Alex Morgan's Savings account and read the balance.",
      outputs: {
        savingsBalance: '$12,840.50',
      },
    });

    expect(received?.model).toBe('gpt-4.1-mini');
    expect(received?.modelInputJson).toContain('$12,840.50');
    const transmittedInput = JSON.parse(received?.modelInputJson ?? '{}') as Record<
      string,
      unknown
    >;

    expect(transmittedInput).toHaveProperty('goal', "Read Alex Morgan's Savings balance");

    expect(transmittedInput).toHaveProperty('step', 4);
    expect(transmittedInput).toHaveProperty('currentObservation');
    expect(transmittedInput).toHaveProperty('recent');
    expect(transmittedInput).toHaveProperty('history');
    expect(received?.systemPrompt).toContain('Do not invent controls');
    expect(received?.decisionContract).toContain('"complete"');

    expect(received?.decisionContract).toContain('"escalate"');

    expect(JSON.stringify(received)).not.toContain(config.apiKey);
  });

  it('rejects malformed decision arguments', async () => {
    const transport: OpenAIDecisionTransport = () =>
      Promise.resolve({
        decision: {
          kind: 'complete',
          argumentsJson: '{not-json',
        },
      });

    const model = new OpenAIDiscoveryDecisionModel(config, transport);

    await expect(
      model.decide({
        observation,
      }),
    ).rejects.toBeInstanceOf(DiscoveryModelResponseError);
  });

  it('rejects arguments that redefine the decision kind', async () => {
    const transport: OpenAIDecisionTransport = () =>
      Promise.resolve({
        decision: {
          kind: 'complete',
          argumentsJson: JSON.stringify({
            kind: 'escalate',
            summary: 'Unsupported',
            outputs: {},
          }),
        },
      });

    const model = new OpenAIDiscoveryDecisionModel(config, transport);

    await expect(
      model.decide({
        observation,
      }),
    ).rejects.toThrow('must not redefine kind');
  });

  it('rejects domain-invalid structured decisions', async () => {
    const transport: OpenAIDecisionTransport = () =>
      Promise.resolve({
        decision: {
          kind: 'complete',
          argumentsJson: JSON.stringify({
            summary: '',
            outputs: {},
          }),
        },
      });

    const model = new OpenAIDiscoveryDecisionModel(config, transport);

    await expect(
      model.decide({
        observation,
      }),
    ).rejects.toThrow('did not satisfy the DiscoveryDecision contract');
  });

  it('rejects missing or invalid structured output', async () => {
    const transport: OpenAIDecisionTransport = () => Promise.resolve(null);

    const model = new OpenAIDiscoveryDecisionModel(config, transport);

    await expect(
      model.decide({
        observation,
      }),
    ).rejects.toThrow('no valid structured discovery decision');
  });
});
