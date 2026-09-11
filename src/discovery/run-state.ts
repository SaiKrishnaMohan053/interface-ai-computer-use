import type { RuntimeResult } from '../runtime/index.js';

import type { JsonValue, Timestamp } from '../surface/index.js';

import type { DiscoveryRequest, DiscoveryRunConfig } from './contracts.js';

import type { DiscoveryDecision } from './decision.js';

export type DiscoveryStepOutcome =
  | 'decision_recorded'
  | 'action_succeeded'
  | 'action_failed'
  | 'value_extracted'
  | 'completion_rejected'
  | 'completed'
  | 'escalated';

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
  extractedValues: Record<string, JsonValue>;
  recentSteps: DiscoveryStepRecord[];
}

/**
 * Discovery reuses the Phase 1 runtime result contract.
 * It does not introduce a competing result taxonomy.
 */
export type DiscoveryResult = RuntimeResult;
