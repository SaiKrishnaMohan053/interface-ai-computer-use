import { ZodError } from 'zod';

import { parseDiscoveryDecision } from './decision.js';

import type { DiscoveryDecision } from './decision.js';

import { DiscoveryModelResponseError } from './model/index.js';

import type { DiscoveryDecisionModel, DiscoveryModelInput } from './model/index.js';

export const DEFAULT_DISCOVERY_MODEL_FORMAT_RETRIES = 1;
export const MAX_DISCOVERY_MODEL_FORMAT_RETRIES = 3;

export class DiscoveryDecisionValidationError extends Error {
  readonly code = 'MODEL_DECISION_VALIDATION_FAILED' as const;

  constructor(
    readonly attempts: number,
    readonly issues: readonly string[],
    options?: ErrorOptions,
  ) {
    super(`Model decision failed validation after ${attempts} attempts`, options);

    this.name = 'DiscoveryDecisionValidationError';
  }
}

export interface ValidatedDiscoveryDecision {
  readonly decision: DiscoveryDecision;
  readonly attempts: number;
}

export interface InvalidDiscoveryDecisionAttempt {
  readonly attempt: number;
  readonly issues: readonly string[];
}

function validationIssues(error: ZodError | DiscoveryModelResponseError): readonly string[] {
  if (error instanceof ZodError) {
    return error.issues.slice(0, 10).map((issue) => {
      const path = issue.path.length === 0 ? 'decision' : issue.path.join('.');

      return `${path}: ${issue.message}`;
    });
  }

  return [error.message];
}

/**
 * Requests one decision and retries only invalid structured/model output.
 *
 * Transport errors and unexpected internal errors are not retried here.
 */
export async function requestValidatedDiscoveryDecision(input: {
  readonly model: DiscoveryDecisionModel;
  readonly modelInput: DiscoveryModelInput;
  readonly maxFormatRetries?: number;
  readonly onRequest?: (attempt: number) => void | Promise<void>;

  readonly onInvalid?: (invalid: InvalidDiscoveryDecisionAttempt) => void | Promise<void>;
}): Promise<ValidatedDiscoveryDecision> {
  const maxFormatRetries = input.maxFormatRetries ?? DEFAULT_DISCOVERY_MODEL_FORMAT_RETRIES;

  if (
    !Number.isInteger(maxFormatRetries) ||
    maxFormatRetries < 0 ||
    maxFormatRetries > MAX_DISCOVERY_MODEL_FORMAT_RETRIES
  ) {
    throw new RangeError(
      `maxFormatRetries must be an integer between 0 and ${MAX_DISCOVERY_MODEL_FORMAT_RETRIES}`,
    );
  }

  let lastError: ZodError | DiscoveryModelResponseError | null = null;
  let modelInput = input.modelInput;

  for (let attempt = 1; attempt <= maxFormatRetries + 1; attempt += 1) {
    await input.onRequest?.(attempt);
    try {
      const rawDecision: unknown = await input.model.decide(modelInput);

      return {
        decision: parseDiscoveryDecision(rawDecision),
        attempts: attempt,
      };
    } catch (error) {
      if (!(error instanceof ZodError) && !(error instanceof DiscoveryModelResponseError)) {
        throw error;
      }

      lastError = error;
      const issues = validationIssues(error);

      await input.onInvalid?.({
        attempt,
        issues,
      });

      modelInput = {
        ...input.modelInput,
        validationFeedback: issues,
      };
    }
  }

  const attempts = maxFormatRetries + 1;

  const issues =
    lastError === null ? ['Unknown decision validation error'] : validationIssues(lastError);

  throw new DiscoveryDecisionValidationError(attempts, issues, {
    cause: lastError ?? undefined,
  });
}
