import { z } from 'zod';

import {
  agentActionOutcomeSchema,
  agentConditionOutcomeSchema,
  agentErrorSchema,
  agentObservationSchema,
} from '../agent-observation.js';

import type { AgentObservation } from '../agent-observation.js';

import { DISCOVERY_DECISION_KINDS } from '../decision.js';

import type { DiscoveryDecision } from '../decision.js';

import { sanitizeModelContextValue } from '../observation-projector.js';

export const DISCOVERY_MODEL_HISTORY_LIMIT = 5;
export const DISCOVERY_HISTORY_SUMMARY_LIMIT = 1_000;
export const DISCOVERY_VALIDATION_FEEDBACK_LIMIT = 10;
export const DISCOVERY_VALIDATION_ISSUE_LIMIT = 500;

export const discoveryHistoryEntrySchema = z
  .object({
    step: z.number().int().nonnegative(),
    decisionKind: z.enum(DISCOVERY_DECISION_KINDS),
    outcome: z.enum(['success', 'failure', 'not_met', 'completed', 'escalated']),
    summary: z
      .string()
      .trim()
      .min(1, 'History summary must not be empty')
      .max(DISCOVERY_HISTORY_SUMMARY_LIMIT),
  })
  .strict();

const currentAgentObservationSchema = agentObservationSchema.omit({
  goal: true,
  step: true,
  recentAction: true,
  recentCondition: true,
  recentError: true,
});

export const discoveryModelContextSchema = z
  .object({
    goal: z.string().trim().min(1).max(4_000),
    step: z.number().int().nonnegative(),

    currentObservation: currentAgentObservationSchema,

    recent: z
      .object({
        action: agentActionOutcomeSchema.nullable(),
        condition: agentConditionOutcomeSchema.nullable(),
        error: agentErrorSchema.nullable(),
      })
      .strict(),

    history: z.array(discoveryHistoryEntrySchema).max(DISCOVERY_MODEL_HISTORY_LIMIT),

    validationFeedback: z
      .array(z.string().trim().min(1).max(DISCOVERY_VALIDATION_ISSUE_LIMIT))
      .max(DISCOVERY_VALIDATION_FEEDBACK_LIMIT),
  })
  .strict();

export type DiscoveryHistoryEntry = z.infer<typeof discoveryHistoryEntrySchema>;

export type DiscoveryModelContext = z.infer<typeof discoveryModelContextSchema>;

export interface DiscoveryModelInput {
  readonly observation: AgentObservation;
  /** Bounded feedback supplied only after an invalid model-format attempt. */
  readonly validationFeedback?: readonly string[];

  /**
   * Optional for the first discovery step. When supplied, only the latest
   * DISCOVERY_MODEL_HISTORY_LIMIT entries reach the model.
   */
  readonly history?: readonly DiscoveryHistoryEntry[];
}

export interface DiscoveryDecisionModel {
  decide(input: DiscoveryModelInput): Promise<DiscoveryDecision>;
}

function sanitizeHistorySummary(summary: string): string {
  const sanitized = sanitizeModelContextValue(summary);

  if (typeof sanitized !== 'string') {
    throw new TypeError('Discovery history summary must sanitize to text');
  }

  return sanitized.trim().slice(0, DISCOVERY_HISTORY_SUMMARY_LIMIT);
}

function buildBoundedHistory(history: readonly DiscoveryHistoryEntry[]): DiscoveryHistoryEntry[] {
  return history.slice(-DISCOVERY_MODEL_HISTORY_LIMIT).map((entry) =>
    discoveryHistoryEntrySchema.parse({
      step: entry.step,
      decisionKind: entry.decisionKind,
      outcome: entry.outcome,
      summary: sanitizeHistorySummary(entry.summary),
    }),
  );
}

function buildValidationFeedback(issues: readonly string[]): string[] {
  return issues
    .slice(0, DISCOVERY_VALIDATION_FEEDBACK_LIMIT)
    .map((issue) => issue.trim().slice(0, DISCOVERY_VALIDATION_ISSUE_LIMIT))
    .filter((issue) => issue.length > 0);
}

export function createDiscoveryModelInput(input: {
  readonly observation: AgentObservation;
  readonly history?: readonly DiscoveryHistoryEntry[];
  readonly validationFeedback?: readonly string[];
}): DiscoveryModelInput {
  const observation = agentObservationSchema.parse(input.observation);

  const history = buildBoundedHistory(input.history ?? []);

  return {
    observation,
    history,
    validationFeedback: buildValidationFeedback(input.validationFeedback ?? []),
  };
}

export function buildDiscoveryModelContext(input: DiscoveryModelInput): DiscoveryModelContext {
  const normalizedInput = createDiscoveryModelInput(input);

  const { goal, step, recentAction, recentCondition, recentError, ...currentObservation } =
    normalizedInput.observation;

  return discoveryModelContextSchema.parse({
    goal,
    step,
    currentObservation,

    recent: {
      action: recentAction,
      condition: recentCondition,
      error: recentError,
    },

    history: normalizedInput.history ?? [],
    validationFeedback: normalizedInput.validationFeedback ?? [],
  });
}
