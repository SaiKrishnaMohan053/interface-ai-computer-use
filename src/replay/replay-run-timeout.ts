import type { JsonValue } from '../surface/index.js';

export interface ReplayRunTimeoutLimits {
  readonly maxDurationMs: number;
}

export interface ReplayRunTimeoutSnapshot {
  readonly startedAtMs: number;
  readonly nowMs: number;
  readonly elapsedMs: number;
  readonly maxDurationMs: number;
  readonly remainingMs: number;
  readonly timedOut: boolean;
}

export interface ReplayRunTimeoutFailure {
  readonly code: 'RUN_TIMEOUT';
  readonly message: string;
  readonly stepId: string | null;
  readonly expected: JsonValue;
  readonly observed: JsonValue;

  readonly details: Readonly<Record<string, JsonValue>>;
}

export interface ReplayRunTimeoutGuardOptions {
  readonly startedAtMs: number;
  readonly limits: ReplayRunTimeoutLimits;

  /**
   * Injected clock keeps timeout-state evaluation deterministic
   * in unit tests.
   */
  readonly now?: () => number;
}

function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative number`);
  }
}

function assertPositiveDuration(value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Replay maxDurationMs must be a positive finite number');
  }
}

/**
 * Total deterministic replay runtime budget.
 *
 * This object does not own browser/session lifecycle and does
 * not invent a second timeout taxonomy.
 *
 * The replay orchestrator checks this guard before beginning
 * another action/checkpoint/recovery operation.
 *
 * Long-running adapter operations must receive the guard's
 * AbortSignal so the same total deadline can interrupt them.
 */
export class ReplayRunTimeoutGuard {
  private readonly now: () => number;

  private readonly abortController = new AbortController();

  private timer: ReturnType<typeof setTimeout> | undefined;

  private timedOut = false;

  readonly startedAtMs: number;

  readonly maxDurationMs: number;

  constructor(options: ReplayRunTimeoutGuardOptions) {
    assertFiniteNonNegative(options.startedAtMs, 'Replay startedAtMs');

    assertPositiveDuration(options.limits.maxDurationMs);

    this.startedAtMs = options.startedAtMs;

    this.maxDurationMs = options.limits.maxDurationMs;

    this.now = options.now ?? Date.now;
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  snapshot(): ReplayRunTimeoutSnapshot {
    const nowMs = this.now();

    const elapsedMs = Math.max(0, nowMs - this.startedAtMs);

    const remainingMs = Math.max(0, this.maxDurationMs - elapsedMs);

    const timedOut = this.timedOut || elapsedMs >= this.maxDurationMs;

    return {
      startedAtMs: this.startedAtMs,

      nowMs,

      elapsedMs,

      maxDurationMs: this.maxDurationMs,

      remainingMs,

      timedOut,
    };
  }

  /**
   * Starts one wall-clock deadline for the whole replay run.
   *
   * Calling start more than once is harmless.
   */
  start(): void {
    if (this.timer !== undefined || this.timedOut) {
      return;
    }

    const snapshot = this.snapshot();

    if (snapshot.timedOut) {
      this.expire();
      return;
    }

    this.timer = setTimeout(() => {
      this.expire();
    }, snapshot.remainingMs);
  }

  /**
   * Stops the timer after terminal run completion.
   */
  stop(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);

      this.timer = undefined;
    }
  }

  /**
   * Returns true when another replay operation may begin.
   */
  canContinue(): boolean {
    const snapshot = this.snapshot();

    if (snapshot.timedOut) {
      this.expire();

      return false;
    }

    return true;
  }

  failure(stepId: string | null): ReplayRunTimeoutFailure {
    const snapshot = this.snapshot();

    return {
      code: 'RUN_TIMEOUT',

      message: 'Replay exceeded its total runtime budget.',

      stepId,

      expected: {
        maxDurationMs: this.maxDurationMs,
      },

      observed: {
        elapsedMs: snapshot.elapsedMs,
      },

      details: {
        phase: 'run_timeout',

        maxDurationMs: this.maxDurationMs,

        elapsedMs: snapshot.elapsedMs,

        remainingMs: snapshot.remainingMs,

        timedOut: true,
      },
    };
  }

  private expire(): void {
    if (this.timedOut) {
      return;
    }

    this.timedOut = true;

    this.stop();

    this.abortController.abort(new Error('RUN_TIMEOUT'));
  }
}
