import type {
  RuntimeBusinessOutcome,
  RuntimeFailure,
  RuntimeInterventionRequired,
  RuntimeResult,
} from '../runtime/index.js';

import type { JsonValue } from '../surface/index.js';

/**
 * One successfully produced artifact output during replay.
 */
export interface ReplayStepOutput {
  readonly name: string;
  readonly value: JsonValue;
}

interface ReplayStepResultBase {
  readonly stepId: string;

  /**
   * Zero-based index in CapabilityArtifact.steps.
   */
  readonly stepIndex: number;
}

/**
 * Internal result returned by deterministic step execution.
 *
 * This is intentionally smaller than ReplayResult:
 *
 * ReplayResult describes the complete run.
 * ReplayStepResult describes what happened while executing one artifact step.
 */
export type ReplayStepResult =
  | (ReplayStepResultBase & {
      readonly status: 'success';
      readonly output?: ReplayStepOutput;
    })
  | (ReplayStepResultBase & {
      readonly status: 'business_outcome';
      readonly outcome: RuntimeBusinessOutcome['outcome'];
    })
  | (ReplayStepResultBase & {
      readonly status: 'intervention_required';
      readonly intervention: RuntimeInterventionRequired['intervention'];
    })
  | (ReplayStepResultBase & {
      readonly status: 'failure';
      readonly error: RuntimeFailure['error'];
    });

/**
 * Deterministic, run-scoped replay state.
 *
 * No LLM history, prompt state, conversation memory, model messages,
 * provider state, or discovery reasoning belongs here.
 */
export interface ReplayRunState {
  readonly runId: string;

  /**
   * Zero-based index of the artifact step currently being processed.
   */
  readonly currentStepIndex: number;

  /**
   * Number of artifact steps that completed successfully.
   */
  readonly stepsExecuted: number;

  /**
   * Declared capability outputs collected during this run.
   */
  readonly outputs: Readonly<Record<string, JsonValue>>;

  /**
   * Recovery attempts keyed by a deterministic runtime recovery key.
   *
   * Example:
   * submit-member-search:TRANSIENT_LOAD
   */
  readonly recoveryAttempts: Readonly<Record<string, number>>;

  /**
   * Wall-clock value used only for deterministic timeout accounting.
   */
  readonly startedAtMs: number;

  /**
   * Optional run deadline calculated from ReplayOptions.timeoutMs.
   */
  readonly deadlineAtMs?: number;

  /**
   * Last valid observation used by replay orchestration.
   *
   * We retain only the ID here, not a raw DOM/browser handle.
   */
  readonly lastObservationId?: string;
}

/**
 * Useful type aliases for terminal values that the future ReplayEngine
 * will return without redefining the canonical runtime result shapes.
 */
export type ReplayTerminalResult = RuntimeResult;

export type ReplayTerminalFailure = RuntimeFailure;
