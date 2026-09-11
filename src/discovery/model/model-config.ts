import { z } from 'zod';

export const SUPPORTED_OPENAI_DISCOVERY_MODELS = [
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-5',
  'gpt-5-mini',
  'gpt-5-nano',
  'gpt-6-astra',
] as const;

export type ModelConfigurationIssueCode = 'MISSING' | 'UNSUPPORTED_MODEL' | 'INVALID_LIMIT';

export interface ModelConfigurationIssue {
  readonly code: ModelConfigurationIssueCode;
  readonly field:
    | 'OPENAI_API_KEY'
    | 'OPENAI_MODEL'
    | 'OPENAI_TIMEOUT_MS'
    | 'OPENAI_MAX_RETRIES'
    | 'OPENAI_MAX_OUTPUT_TOKENS';
  readonly message: string;
}

export class ModelConfigurationError extends Error {
  readonly code = 'MODEL_CONFIGURATION_INVALID';
  readonly issues: readonly ModelConfigurationIssue[];

  constructor(issues: readonly ModelConfigurationIssue[]) {
    super(
      `OpenAI discovery model configuration is invalid: ${issues
        .map((issue) => issue.message)
        .join('; ')}`,
    );

    this.name = 'ModelConfigurationError';
    this.issues = Object.freeze([...issues]);

    Object.freeze(this);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      issues: this.issues,
    };
  }
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isSupportedOpenAIDiscoveryModel(model: string): boolean {
  return SUPPORTED_OPENAI_DISCOVERY_MODELS.some(
    (supportedModel) =>
      model === supportedModel ||
      new RegExp(`^${escapeRegularExpression(supportedModel)}-\\d{4}-\\d{2}-\\d{2}$`).test(model),
  );
}

const environmentInteger = (field: string, fallback: number, minimum: number, maximum: number) =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? fallback : value),
    z.coerce
      .number()
      .int(`${field} must be an integer`)
      .min(minimum, `${field} is below the supported minimum`)
      .max(maximum, `${field} exceeds the supported maximum`),
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
      .max(200, 'OPENAI_MODEL is too long')
      .refine(
        isSupportedOpenAIDiscoveryModel,
        'OPENAI_MODEL does not support the configured discovery structured-output contract',
      ),

    timeoutMs: environmentInteger('OPENAI_TIMEOUT_MS', 30_000, 1_000, 300_000),

    maxRetries: environmentInteger('OPENAI_MAX_RETRIES', 2, 0, 10),

    maxOutputTokens: environmentInteger('OPENAI_MAX_OUTPUT_TOKENS', 4_096, 256, 16_384),
  })
  .strict();

export type OpenAIDiscoveryModelConfig = z.infer<typeof openAIDiscoveryModelConfigSchema>;

const environmentFields = {
  apiKey: 'OPENAI_API_KEY',
  model: 'OPENAI_MODEL',
  timeoutMs: 'OPENAI_TIMEOUT_MS',
  maxRetries: 'OPENAI_MAX_RETRIES',
  maxOutputTokens: 'OPENAI_MAX_OUTPUT_TOKENS',
} as const;

function createConfigurationIssues(input: unknown, error: z.ZodError): ModelConfigurationIssue[] {
  const record =
    input !== null && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};

  const issues = new Map<ModelConfigurationIssue['field'], ModelConfigurationIssue>();

  for (const validationIssue of error.issues) {
    const path = validationIssue.path[0];

    if (typeof path !== 'string' || !(path in environmentFields)) {
      continue;
    }

    const configField = path as keyof typeof environmentFields;
    const environmentField = environmentFields[configField];
    const suppliedValue = record[configField];

    let issue: ModelConfigurationIssue;

    if (
      (configField === 'apiKey' || configField === 'model') &&
      (typeof suppliedValue !== 'string' || suppliedValue.trim().length === 0)
    ) {
      issue = {
        code: 'MISSING',
        field: environmentField,
        message: `${environmentField} is required`,
      };
    } else if (configField === 'model') {
      issue = {
        code: 'UNSUPPORTED_MODEL',
        field: environmentField,
        message: 'OPENAI_MODEL is not supported for discovery structured output',
      };
    } else {
      issue = {
        code: 'INVALID_LIMIT',
        field: environmentField,
        message: `${environmentField} has an invalid limit`,
      };
    }

    issues.set(environmentField, issue);
  }

  if (issues.size === 0) {
    issues.set('OPENAI_MODEL', {
      code: 'UNSUPPORTED_MODEL',
      field: 'OPENAI_MODEL',
      message: 'OpenAI discovery model configuration is invalid',
    });
  }

  return [...issues.values()];
}

export function validateOpenAIDiscoveryModelConfig(input: unknown): OpenAIDiscoveryModelConfig {
  const result = openAIDiscoveryModelConfigSchema.safeParse(input);

  if (!result.success) {
    throw new ModelConfigurationError(createConfigurationIssues(input, result.error));
  }

  return result.data;
}

export function loadOpenAIDiscoveryModelConfig(
  environment: NodeJS.ProcessEnv = process.env,
): OpenAIDiscoveryModelConfig {
  return validateOpenAIDiscoveryModelConfig({
    apiKey: environment.OPENAI_API_KEY,
    model: environment.OPENAI_MODEL,
    timeoutMs: environment.OPENAI_TIMEOUT_MS,
    maxRetries: environment.OPENAI_MAX_RETRIES,
    maxOutputTokens: environment.OPENAI_MAX_OUTPUT_TOKENS,
  });
}
