import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';

import {
  DISCOVERY_DECISION_KINDS,
  discoveryDecisionSchema,
  parseDiscoveryDecision,
} from '../decision.js';

import type { DiscoveryDecision } from '../decision.js';

import { buildDiscoveryModelContext } from './discovery-decision-model.js';

import type { DiscoveryDecisionModel, DiscoveryModelInput } from './discovery-decision-model.js';

import {
  loadOpenAIDiscoveryModelConfig,
  validateOpenAIDiscoveryModelConfig,
} from './model-config.js';

import type { OpenAIDiscoveryModelConfig } from './model-config.js';

import { DISCOVERY_SYSTEM_PROMPT } from './discovery-system-prompt.js';

const openAIWireDecisionSchema = z
  .object({
    kind: z.enum(DISCOVERY_DECISION_KINDS).describe('The single DiscoveryDecision kind to perform'),

    argumentsJson: z
      .string()
      .describe('A JSON object containing all fields for the selected decision except kind'),
  })
  .strict();

const openAIWireResponseSchema = z
  .object({
    decision: openAIWireDecisionSchema,
  })
  .strict();

type OpenAIWireResponse = z.infer<typeof openAIWireResponseSchema>;

export interface OpenAIDecisionTransportRequest {
  readonly model: string;
  readonly systemPrompt: string;
  readonly decisionContract: string;
  readonly modelInputJson: string;
}

/**
 * Narrow injection seam for unit tests.
 *
 * API keys and OpenAI SDK response types are deliberately absent.
 */
export type OpenAIDecisionTransport = (request: OpenAIDecisionTransportRequest) => Promise<unknown>;

export class DiscoveryModelResponseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DiscoveryModelResponseError';
  }
}

const decisionJsonSchema = JSON.stringify(z.toJSONSchema(discoveryDecisionSchema), null, 2);

function createDefaultTransport(config: OpenAIDiscoveryModelConfig): OpenAIDecisionTransport {
  const client = new OpenAI({
    apiKey: config.apiKey,
    timeout: config.timeoutMs,
    maxRetries: config.maxRetries,
  });

  return async (request: OpenAIDecisionTransportRequest): Promise<unknown> => {
    const response = await client.responses.parse({
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
            'The selected decision must satisfy this DiscoveryDecision JSON Schema:',
            request.decisionContract,
            'Current structured observation:',
            request.modelInputJson,
          ].join('\n\n'),
        },
      ],

      text: {
        format: zodTextFormat(openAIWireResponseSchema, 'discovery_decision'),
      },
    });

    return response.output_parsed;
  };
}

function parseArgumentsJson(argumentsJson: string): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(argumentsJson);
  } catch (error) {
    throw new DiscoveryModelResponseError('Model decision arguments were not valid JSON', {
      cause: error,
    });
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new DiscoveryModelResponseError('Model decision arguments must be a JSON object');
  }

  const argumentsObject = parsed as Record<string, unknown>;

  if ('kind' in argumentsObject) {
    throw new DiscoveryModelResponseError('Model decision arguments must not redefine kind');
  }

  return argumentsObject;
}

function convertWireResponse(response: OpenAIWireResponse): DiscoveryDecision {
  const argumentsObject = parseArgumentsJson(response.decision.argumentsJson);

  try {
    return parseDiscoveryDecision({
      kind: response.decision.kind,
      ...argumentsObject,
    });
  } catch (error) {
    throw new DiscoveryModelResponseError(
      'Model response did not satisfy the DiscoveryDecision contract',
      {
        cause: error,
      },
    );
  }
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

    const rawResponse = await this.transport({
      model: this.config.model,
      systemPrompt: DISCOVERY_SYSTEM_PROMPT,
      decisionContract: decisionJsonSchema,
      modelInputJson: JSON.stringify(modelContext),
    });

    const wireResponse = openAIWireResponseSchema.safeParse(rawResponse);

    if (!wireResponse.success) {
      throw new DiscoveryModelResponseError(
        'OpenAI returned no valid structured discovery decision',
        {
          cause: wireResponse.error,
        },
      );
    }

    return convertWireResponse(wireResponse.data);
  }
}

export function createOpenAIDiscoveryDecisionModelFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): OpenAIDiscoveryDecisionModel {
  const config = loadOpenAIDiscoveryModelConfig(environment);

  return new OpenAIDiscoveryDecisionModel(config);
}
