import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';

import { agentObservationSchema } from '../agent-observation.js';

import {
  DISCOVERY_DECISION_KINDS,
  discoveryDecisionSchema,
  parseDiscoveryDecision,
} from '../decision.js';

import type { DiscoveryDecision } from '../decision.js';

import type { DiscoveryDecisionModel, DiscoveryModelInput } from './discovery-decision-model.js';

import {
  loadOpenAIDiscoveryModelConfig,
  validateOpenAIDiscoveryModelConfig,
} from './model-config.js';

import type { OpenAIDiscoveryModelConfig } from './model-config.js';

const openAIWireDecisionSchema = z
  .object({
    kind: z.enum(DISCOVERY_DECISION_KINDS),

    /**
     * JSON object containing the selected decision's fields except kind.
     * The reconstructed decision is validated by discoveryDecisionSchema.
     */
    argumentsJson: z.string(),
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
  readonly observationJson: string;
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

const DISCOVERY_SYSTEM_PROMPT = `
You are the decision component of a policy-controlled UI discovery engine.

Choose exactly one next DiscoveryDecision based only on the supplied
AgentObservation.

Rules:

1. Do not invent controls, text, account values, dialog state, URLs, or evidence.
2. Use semantic targeting such as role, accessible name, label, visible text,
   and structural table relationships.
3. Do not use CSS selectors, XPath, coordinates, browser handles, or control IDs.
4. Return complete only when the expected result was observed or extracted.
5. Never treat your own completion claim as proof. The engine verifies it.
6. Use escalate when automation is stuck or recovery is exhausted.
7. The PolicyEngine may independently require human intervention.
8. Do not claim that policy approval has been granted.
9. Select only one action for the current step.
10. Do not include kind inside argumentsJson.

Return the provider wire format:

{
  "decision": {
    "kind": "<decision kind>",
    "argumentsJson": "<JSON object containing every other decision field>"
  }
}

The reconstructed decision must conform to this domain JSON Schema:

${decisionJsonSchema}
`.trim();

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
          content: request.observationJson,
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
    const observation = agentObservationSchema.parse(input.observation);

    const rawResponse = await this.transport({
      model: this.config.model,
      systemPrompt: DISCOVERY_SYSTEM_PROMPT,
      observationJson: JSON.stringify(observation),
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
