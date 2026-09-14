import type { JsonValue, Timestamp } from '../surface/index.js';

import type { DiscoveryRequest, DiscoveryRunConfig } from './contracts.js';

import type { DiscoveryDecision } from './decision.js';

import type { DiscoveryRunResult } from './discovery-result.js';

export type DiscoveryStepOutcome =
  | 'decision_recorded'
  | 'action_succeeded'
  | 'action_failed'
  | 'value_extracted'
  | 'completion_rejected'
  | 'completed'
  | 'escalated';

export const DEFAULT_DISCOVERY_RECENT_STEP_LIMIT = 5;
/**
 * Provenance for a value obtained through a successful
 * surface read during the active discovery run.
 */
export interface DiscoveryExtractionRecord {
  readonly outputName: string;
  readonly value: JsonValue;
  readonly source: 'surface_read';
  readonly step: number;
  readonly observationId: string;
  readonly actionId: string;
}

export interface DiscoveryStepRecord {
  readonly step: number;
  readonly observationId: string;
  readonly observationFingerprint: string;
  readonly decision: DiscoveryDecision;
  readonly outcome: DiscoveryStepOutcome;
  readonly result?: JsonValue;
}

/**
 * Short-lived working memory for one active discovery run.
 * This is not persisted long-term and is not agent memory.
 */
export interface DiscoveryRunState {
  readonly runId: string;
  readonly request: DiscoveryRequest;
  readonly config: DiscoveryRunConfig;
  readonly startedAt: Timestamp;
  readonly deadlineAt: Timestamp;

  step: number;
  lastObservationFingerprint: string | null;
  repeatedStateCount: number;

  /**
   * Values available to subsequent model decisions and
   * final discovery output.
   */
  extractedValues: Record<string, JsonValue>;

  /**
   * Read provenance used to reject unsupported
   * completion claims.
   */
  extractions: DiscoveryExtractionRecord[];

  recentSteps: DiscoveryStepRecord[];
}

export interface CreateDiscoveryRunStateInput {
  readonly runId: string;
  readonly request: DiscoveryRequest;
  readonly config: DiscoveryRunConfig;
  readonly startedAt: Timestamp;
  readonly deadlineAt: Timestamp;
}

/**
 * Creates fresh process-local working memory for exactly one discovery run.
 */
export function createDiscoveryRunState(input: CreateDiscoveryRunStateInput): DiscoveryRunState {
  return {
    runId: input.runId,
    request: input.request,
    config: input.config,
    startedAt: input.startedAt,
    deadlineAt: input.deadlineAt,
    step: 0,
    lastObservationFingerprint: null,
    repeatedStateCount: 0,
    extractedValues: {},
    extractions: [],
    recentSteps: [],
  };
}

/**
 * Updates consecutive-state detection and returns the current repeat count.
 */
export function recordDiscoveryObservationFingerprint(
  state: DiscoveryRunState,
  observationFingerprint: string,
): number {
  state.repeatedStateCount =
    state.lastObservationFingerprint === observationFingerprint ? state.repeatedStateCount + 1 : 1;

  state.lastObservationFingerprint = observationFingerprint;

  return state.repeatedStateCount;
}

/**
 * Keeps only a small bounded window of recent decisions and outcomes.
 */
export function appendDiscoveryStep(
  state: DiscoveryRunState,
  record: DiscoveryStepRecord,
  limit = DEFAULT_DISCOVERY_RECENT_STEP_LIMIT,
): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError('Recent discovery step limit must be an integer between 1 and 100');
  }

  state.recentSteps.push(record);

  if (state.recentSteps.length > limit) {
    state.recentSteps.splice(0, state.recentSteps.length - limit);
  }
}

/**
 * Discovery extends the Phase 1 runtime result with
 * bounded progress metadata.
 */
export type DiscoveryResult = DiscoveryRunResult;
