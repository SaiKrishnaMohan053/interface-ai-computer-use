import { describe, expect, it } from 'vitest';

import {
  ModelConfigurationError,
  isSupportedOpenAIDiscoveryModel,
  loadOpenAIDiscoveryModelConfig,
  validateOpenAIDiscoveryModelConfig,
} from '../../src/discovery/index.js';

describe('model configuration validation', () => {
  it('fails early with a clean missing API key error', () => {
    expect.assertions(5);

    try {
      loadOpenAIDiscoveryModelConfig({
        OPENAI_MODEL: 'gpt-4.1-mini',
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ModelConfigurationError);

      const configurationError = error as ModelConfigurationError;

      expect(configurationError.code).toBe('MODEL_CONFIGURATION_INVALID');

      expect(configurationError.issues).toContainEqual({
        code: 'MISSING',
        field: 'OPENAI_API_KEY',
        message: 'OPENAI_API_KEY is required',
      });

      expect(configurationError.message).toContain('OPENAI_API_KEY is required');

      expect(configurationError.message).not.toContain('undefined');
    }
  });

  it('rejects unsupported model capabilities', () => {
    expect(() =>
      loadOpenAIDiscoveryModelConfig({
        OPENAI_API_KEY: 'test-secret-key',
        OPENAI_MODEL: 'text-embedding-3-small',
      }),
    ).toThrow('OPENAI_MODEL is not supported for discovery structured output');
  });

  it('supports approved aliases and dated snapshots', () => {
    expect(isSupportedOpenAIDiscoveryModel('gpt-4.1-mini')).toBe(true);

    expect(isSupportedOpenAIDiscoveryModel('gpt-4.1-mini-2025-04-14')).toBe(true);

    expect(isSupportedOpenAIDiscoveryModel('text-embedding-3-small')).toBe(false);
  });

  it.each([
    ['OPENAI_TIMEOUT_MS', '999'],
    ['OPENAI_TIMEOUT_MS', '300001'],
    ['OPENAI_TIMEOUT_MS', 'not-a-number'],
    ['OPENAI_MAX_RETRIES', '-1'],
    ['OPENAI_MAX_RETRIES', '11'],
    ['OPENAI_MAX_OUTPUT_TOKENS', '255'],
    ['OPENAI_MAX_OUTPUT_TOKENS', '16385'],
  ])('rejects invalid limit %s=%s', (field, value) => {
    expect(() =>
      loadOpenAIDiscoveryModelConfig({
        OPENAI_API_KEY: 'test-secret-key',
        OPENAI_MODEL: 'gpt-4.1-mini',
        [field]: value,
      }),
    ).toThrow(`${field} has an invalid limit`);
  });

  it('never includes the API key in thrown errors', () => {
    const apiKey = 'sk-this-value-must-never-appear-in-errors';

    expect.assertions(4);

    try {
      validateOpenAIDiscoveryModelConfig({
        apiKey,
        model: 'unsupported-model',
        timeoutMs: -1,
        maxRetries: 2,
        maxOutputTokens: 4_096,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ModelConfigurationError);

      expect(String(error)).not.toContain(apiKey);
      expect(JSON.stringify(error)).not.toContain(apiKey);

      expect(JSON.stringify((error as ModelConfigurationError).issues)).not.toContain(apiKey);
    }
  });

  it('returns only validated and normalized configuration', () => {
    expect(
      loadOpenAIDiscoveryModelConfig({
        OPENAI_API_KEY: '  test-api-key  ',
        OPENAI_MODEL: '  gpt-4.1-mini  ',
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
});
