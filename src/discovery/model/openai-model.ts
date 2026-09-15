import OpenAI from 'openai';
import { z } from 'zod';

import { discoveryDecisionSchema, parseDiscoveryDecision } from '../decision.js';

import type { DiscoveryDecision } from '../decision.js';

import { buildDiscoveryModelContext } from './discovery-decision-model.js';

import type { DiscoveryDecisionModel, DiscoveryModelInput } from './discovery-decision-model.js';

import {
  loadOpenAIDiscoveryModelConfig,
  validateOpenAIDiscoveryModelConfig,
} from './model-config.js';

import type { OpenAIDiscoveryModelConfig } from './model-config.js';

import { DISCOVERY_SYSTEM_PROMPT } from './discovery-system-prompt.js';

export interface OpenAIDecisionTransportRequest {
  readonly model: string;
  readonly systemPrompt: string;
  readonly decisionContract: string;
  readonly modelInputJson: string;
}

/**
 * Narrow injection seam that excludes credentials
 * and OpenAI SDK response types.
 */
export type OpenAIDecisionTransport = (request: OpenAIDecisionTransportRequest) => Promise<unknown>;

export class DiscoveryModelResponseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DiscoveryModelResponseError';
  }
}

/**
 * Represents an OpenAI/provider request failure.
 *
 * The public message intentionally excludes provider error text,
 * request payloads, and credentials.
 */
export class DiscoveryModelRequestError extends Error {
  readonly code = 'MODEL_REQUEST_FAILED' as const;

  constructor(options?: ErrorOptions) {
    super('OpenAI discovery decision request failed', options);

    this.name = 'DiscoveryModelRequestError';
  }
}

const decisionJsonSchema = JSON.stringify(z.toJSONSchema(discoveryDecisionSchema), null, 2);

function parseJsonObject(text: string): unknown {
  const candidate = text.trim();

  if (candidate.length === 0) {
    throw new DiscoveryModelResponseError('OpenAI returned no structured discovery decision');
  }

  try {
    return JSON.parse(candidate);
  } catch (error) {
    throw new DiscoveryModelResponseError('OpenAI returned an invalid JSON discovery decision', {
      cause: error,
    });
  }
}

function createDefaultTransport(config: OpenAIDiscoveryModelConfig): OpenAIDecisionTransport {
  const client = new OpenAI({
    apiKey: config.apiKey,
    timeout: config.timeoutMs,
    maxRetries: config.maxRetries,
  });

  return async (request: OpenAIDecisionTransportRequest): Promise<unknown> => {
    const response = await client.responses.create({
      model: request.model,
      max_output_tokens: config.maxOutputTokens,

      input: [
        {
          role: 'system',
          content: request.systemPrompt,
        },
        {
          role: 'user',
          content: [
            'Return exactly one JSON object that directly satisfies this DiscoveryDecision JSON Schema.',
            'Do not wrap the decision in another object or encode it as a JSON string.',
            request.decisionContract,
            'Current structured observation:',
            request.modelInputJson,
          ].join('\n\n'),
        },
      ],

      text: {
        format: {
          type: 'json_object',
        },
      },
    });

    return parseJsonObject(response.output_text);
  };
}

export class OpenAIDiscoveryDecisionModel implements DiscoveryDecisionModel {
  private readonly config: OpenAIDiscoveryModelConfig;
  private readonly transport: OpenAIDecisionTransport;

  constructor(config: OpenAIDiscoveryModelConfig, transport?: OpenAIDecisionTransport) {
    this.config = validateOpenAIDiscoveryModelConfig(config);

    this.transport = transport ?? createDefaultTransport(this.config);
  }

  async decide(input: DiscoveryModelInput): Promise<DiscoveryDecision> {
    const modelContext = buildDiscoveryModelContext(input);

    let rawResponse: unknown;

    try {
      rawResponse = await this.transport({
        model: this.config.model,
        systemPrompt: DISCOVERY_SYSTEM_PROMPT,
        decisionContract: decisionJsonSchema,
        modelInputJson: JSON.stringify(modelContext),
      });
    } catch (error) {
      /*
       * Response-format failures remain response errors
       * so the bounded structured-output retry can handle them.
       */
      if (error instanceof DiscoveryModelResponseError) {
        throw error;
      }

      /*
       * Provider/API errors receive a stable public error.
       * Do not copy the provider message because it may
       * contain credentials or sensitive request details.
       */
      throw new DiscoveryModelRequestError({
        cause: error,
      });
    }

    try {
      return parseDiscoveryDecision(rawResponse);
    } catch (error) {
      throw new DiscoveryModelResponseError(
        'Model response did not satisfy the DiscoveryDecision contract',
        {
          cause: error,
        },
      );
    }
  }
}

export function createOpenAIDiscoveryDecisionModelFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): OpenAIDiscoveryDecisionModel {
  const config = loadOpenAIDiscoveryModelConfig(environment);

  return new OpenAIDiscoveryDecisionModel(config);
}
