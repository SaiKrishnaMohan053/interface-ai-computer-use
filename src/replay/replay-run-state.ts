import type { JsonValue } from '../surface/index.js';

export interface ReplayObservedState {
  readonly observationId: string;
  readonly capturedAt: string;
  readonly url: string | null;
  readonly state: JsonValue;
}

export interface ReplayExecutionStateSnapshot {
  readonly currentStepIndex: number;

  readonly outputs: Readonly<Record<string, JsonValue>>;

  readonly recoveryAttempts: Readonly<Record<string, number>>;

  readonly startedAt: number;

  readonly lastObservedState?: ReplayObservedState;
}

export interface ReplayExecutionStateOptions {
  readonly startedAt: number;
}

function assertStepIndex(stepIndex: number): void {
  if (!Number.isInteger(stepIndex) || stepIndex < 0) {
    throw new Error('Replay currentStepIndex must be a non-negative integer');
  }
}

function assertStartedAt(startedAt: number): void {
  if (!Number.isFinite(startedAt) || startedAt < 0) {
    throw new Error('Replay startedAt must be a finite non-negative number');
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

/**
 * Mutable deterministic state for one replay execution.
 *
 * Deliberately contains no:
 *
 * - LLM messages
 * - agent history
 * - model decisions
 * - agent memory
 * - reasoning traces
 * - discovery history
 *
 * The existing ReplayRunState type remains the replay engine's
 * ordered-step orchestration contract. This class owns only the
 * mutable deterministic execution data required by Phase 4.28.
 */
export class ReplayExecutionState {
  private currentStepIndex = 0;

  private readonly outputs = new Map<string, JsonValue>();

  private readonly recoveryAttempts = new Map<string, number>();

  private lastObservedState: ReplayObservedState | undefined;

  readonly startedAt: number;

  constructor(options: ReplayExecutionStateOptions) {
    assertStartedAt(options.startedAt);

    this.startedAt = options.startedAt;
  }

  get stepIndex(): number {
    return this.currentStepIndex;
  }

  setCurrentStepIndex(stepIndex: number): void {
    assertStepIndex(stepIndex);

    this.currentStepIndex = stepIndex;
  }

  advanceStep(): number {
    this.currentStepIndex += 1;

    return this.currentStepIndex;
  }

  setOutput(outputName: string, value: JsonValue): void {
    assertNonEmpty(outputName, 'Replay output name');

    /*
     * JsonValue excludes undefined, so invalid output
     * extraction cannot silently become a successful
     * replay output.
     */
    this.outputs.set(outputName, value);
  }

  hasOutput(outputName: string): boolean {
    return this.outputs.has(outputName);
  }

  getOutput(outputName: string): JsonValue | undefined {
    return this.outputs.get(outputName);
  }

  incrementRecoveryAttempt(stepId: string, conditionType: string): number {
    assertNonEmpty(stepId, 'Replay recovery step ID');

    assertNonEmpty(conditionType, 'Replay recovery condition type');

    const key = ReplayExecutionState.recoveryKey(stepId, conditionType);

    const next = (this.recoveryAttempts.get(key) ?? 0) + 1;

    this.recoveryAttempts.set(key, next);

    return next;
  }

  recoveryAttemptCount(stepId: string, conditionType: string): number {
    const key = ReplayExecutionState.recoveryKey(stepId, conditionType);

    return this.recoveryAttempts.get(key) ?? 0;
  }

  recordObservedState(observation: ReplayObservedState): void {
    assertNonEmpty(observation.observationId, 'Replay observation ID');

    assertNonEmpty(observation.capturedAt, 'Replay observation timestamp');

    this.lastObservedState = {
      observationId: observation.observationId,

      capturedAt: observation.capturedAt,

      url: observation.url,

      state: observation.state,
    };
  }

  snapshot(): ReplayExecutionStateSnapshot {
    const outputs = Object.fromEntries(this.outputs.entries()) as Record<string, JsonValue>;

    const recoveryAttempts = Object.fromEntries(this.recoveryAttempts.entries()) as Record<
      string,
      number
    >;

    const observed = this.lastObservedState;

    return Object.freeze({
      currentStepIndex: this.currentStepIndex,

      outputs: Object.freeze(outputs),

      recoveryAttempts: Object.freeze(recoveryAttempts),

      startedAt: this.startedAt,

      ...(observed === undefined
        ? {}
        : {
            lastObservedState: Object.freeze({
              ...observed,
            }),
          }),
    });
  }

  private static recoveryKey(stepId: string, conditionType: string): string {
    return `${stepId}:${conditionType}`;
  }
}
