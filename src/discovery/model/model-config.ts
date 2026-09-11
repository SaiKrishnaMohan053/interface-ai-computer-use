import { z } from 'zod';

const environmentInteger = (field: string, fallback: number, maximum: number) =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? fallback : value),
    z.coerce
      .number()
      .int(`${field} must be an integer`)
      .nonnegative(`${field} must not be negative`)
      .max(maximum, `${field} is too large`),
  );

export const openAIDiscoveryModelConfigSchema = z
  .object({
    apiKey: z
      .string({
        error: 'OPENAI_API_KEY is required',
      })
      .trim()
      .min(1, 'OPENAI_API_KEY must not be empty'),

    model: z
      .string({
        error: 'OPENAI_MODEL is required',
      })
      .trim()
      .min(1, 'OPENAI_MODEL must not be empty')
      .max(200, 'OPENAI_MODEL is too long'),

    timeoutMs: environmentInteger('OPENAI_TIMEOUT_MS', 30_000, 300_000),

    maxRetries: environmentInteger('OPENAI_MAX_RETRIES', 2, 10),
  })
  .strict();

export type OpenAIDiscoveryModelConfig = z.infer<typeof openAIDiscoveryModelConfigSchema>;

export function loadOpenAIDiscoveryModelConfig(
  environment: NodeJS.ProcessEnv = process.env,
): OpenAIDiscoveryModelConfig {
  return openAIDiscoveryModelConfigSchema.parse({
    apiKey: environment.OPENAI_API_KEY,
    model: environment.OPENAI_MODEL,
    timeoutMs: environment.OPENAI_TIMEOUT_MS,
    maxRetries: environment.OPENAI_MAX_RETRIES,
  });
}
