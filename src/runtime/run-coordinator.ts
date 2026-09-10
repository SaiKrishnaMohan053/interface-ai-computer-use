import { randomUUID } from 'node:crypto';
import { EvidenceRecorder } from '../evidence/index.js';
import type { FinishRunInput, RunEvidenceSummary } from '../evidence/index.js';
import type { PolicyEngine } from '../policy/index.js';
import { SessionManager } from '../session/index.js';
import type {
  ActiveSessionOwner,
  SessionAccess,
  SessionManagerCreateOptions,
} from '../session/index.js';
import type { SurfaceAdapter } from '../surface/index.js';

export type RunCoordinatorMode = Extract<ActiveSessionOwner, 'DISCOVERY' | 'REPLAY'>;

export type RunCoordinatorState =
  'IDLE' | 'STARTING' | 'ACTIVE' | 'FINISHING' | 'CLOSED' | 'FAILED';

export type ManagedSurfaceAdapter<TStrategy> = SurfaceAdapter<TStrategy> & {
  dispose?(): void | Promise<void>;
};

export interface RunCoordinatorDependencies<TStrategy> {
  readonly policyEngine: PolicyEngine;

  readonly createSession?: (options: SessionManagerCreateOptions) => Promise<SessionManager>;

  readonly startEvidence?: typeof EvidenceRecorder.startRun;

  readonly createSurface: (input: {
    readonly access: SessionAccess;
    readonly surfaceId: string;
  }) => ManagedSurfaceAdapter<TStrategy>;
}

export interface StartCoordinatedRunOptions {
  readonly runId: string;
  readonly mode: RunCoordinatorMode;
  readonly sessionId?: string;
  readonly surfaceId?: string;
  readonly evidenceRoot?: string;
  readonly headed?: boolean;
  readonly timeoutMs?: number;
  readonly metadata?: unknown;
}

export interface CoordinatedRunContext<TStrategy> {
  readonly runId: string;
  readonly mode: RunCoordinatorMode;
  readonly sessionManager: SessionManager;
  readonly evidenceRecorder: EvidenceRecorder;
  readonly policyEngine: PolicyEngine;
  readonly surface: SurfaceAdapter<TStrategy>;
}

export interface RunCoordinatorSnapshot {
  readonly state: RunCoordinatorState;
  readonly runId: string | null;
  readonly mode: RunCoordinatorMode | null;
  readonly sessionId: string | null;
}

export type RunCoordinatorErrorCode =
  'INVALID_COORDINATOR_STATE' | 'START_FAILED' | 'FINISH_FAILED';

export class RunCoordinatorError extends Error {
  constructor(
    readonly code: RunCoordinatorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RunCoordinatorError';
  }
}

interface ActiveResources<TStrategy> {
  readonly runId: string;
  readonly mode: RunCoordinatorMode;
  readonly session: SessionManager;
  readonly evidence: EvidenceRecorder;
  readonly surface: ManagedSurfaceAdapter<TStrategy>;
}

/**
 * Owns only the outer lifecycle of one run.
 *
 * Discovery/replay planning, target resolution, policy evaluation
 * and surface actions belong to later orchestration layers.
 */
export class RunCoordinator<TStrategy> {
  private currentState: RunCoordinatorState = 'IDLE';

  private resources: ActiveResources<TStrategy> | null = null;

  private attemptedRunId: string | null = null;

  private attemptedMode: RunCoordinatorMode | null = null;

  constructor(private readonly dependencies: RunCoordinatorDependencies<TStrategy>) {}

  get state(): RunCoordinatorState {
    return this.currentState;
  }

  snapshot(): RunCoordinatorSnapshot {
    return Object.freeze({
      state: this.currentState,
      runId: this.resources?.runId ?? this.attemptedRunId,
      mode: this.resources?.mode ?? this.attemptedMode,
      sessionId: this.resources?.session.sessionId ?? null,
    });
  }

  async start(options: StartCoordinatedRunOptions): Promise<CoordinatedRunContext<TStrategy>> {
    this.requireState('IDLE');

    this.currentState = 'STARTING';
    this.attemptedRunId = options.runId;
    this.attemptedMode = options.mode;

    let evidence: EvidenceRecorder | null = null;

    let session: SessionManager | null = null;

    let surface: ManagedSurfaceAdapter<TStrategy> | null = null;

    try {
      const evidenceOptions = {
        runId: options.runId,
        mode: options.mode,

        ...(options.evidenceRoot === undefined
          ? {}
          : {
              evidenceRoot: options.evidenceRoot,
            }),

        metadata: {
          policyId: this.dependencies.policyEngine.policyId,
          value: options.metadata ?? null,
        },
      };

      evidence = await (this.dependencies.startEvidence === undefined
        ? EvidenceRecorder.startRun(evidenceOptions)
        : this.dependencies.startEvidence(evidenceOptions));

      const sessionOptions = {
        ...(options.sessionId === undefined
          ? {}
          : {
              sessionId: options.sessionId,
            }),

        ...(options.headed === undefined
          ? {}
          : {
              headed: options.headed,
            }),

        ...(options.timeoutMs === undefined
          ? {}
          : {
              timeoutMs: options.timeoutMs,
            }),
      };

      session = await (this.dependencies.createSession === undefined
        ? SessionManager.create(sessionOptions)
        : this.dependencies.createSession(sessionOptions));

      session.activate();

      session.acquireOwnership(options.mode);

      const surfaceId = options.surfaceId ?? randomUUID();

      surface = this.dependencies.createSurface({
        access: session.access(options.mode),
        surfaceId,
      });

      if (surface.scope.sessionId !== session.sessionId || surface.scope.surfaceId !== surfaceId) {
        throw new RunCoordinatorError(
          'START_FAILED',
          'Surface scope does not match the coordinated session',
        );
      }

      await evidence.recordEvent({
        step: 0,
        eventType: 'session_lifecycle',
        result: {
          sessionId: session.sessionId,
          surfaceId,
          state: session.state,
          owner: session.owner,
        },
      });

      this.resources = {
        runId: options.runId,
        mode: options.mode,
        session,
        evidence,
        surface,
      };

      this.currentState = 'ACTIVE';

      return this.context();
    } catch {
      if (session !== null) {
        await session.fail('SESSION_FAILURE').catch(() => undefined);
      }

      if (surface !== null) {
        await this.disposeSurface(surface).catch(() => undefined);
      }

      if (evidence !== null) {
        await evidence
          .finishRun({
            status: 'failure',
            result: {
              code: 'APPLICATION_ERROR',
              phase: 'coordinator_start',
            },
          })
          .catch(() => undefined);
      }

      this.currentState = 'FAILED';

      throw new RunCoordinatorError('START_FAILED', 'Run lifecycle initialization failed');
    }
  }

  context(): CoordinatedRunContext<TStrategy> {
    this.requireState('ACTIVE');

    const resources = this.requireResources();

    return Object.freeze({
      runId: resources.runId,
      mode: resources.mode,
      sessionManager: resources.session,
      evidenceRecorder: resources.evidence,
      policyEngine: this.dependencies.policyEngine,
      surface: resources.surface,
    });
  }

  async finish(input: FinishRunInput): Promise<RunEvidenceSummary> {
    this.requireState('ACTIVE');

    this.currentState = 'FINISHING';

    const resources = this.requireResources();

    try {
      await resources.evidence.recordEvent({
        step: 0,
        eventType: 'session_lifecycle',
        result: {
          state: 'CLOSING',
          owner: resources.session.owner,
        },
      });

      await resources.session.close();

      await this.disposeSurface(resources.surface).catch(() => undefined);

      const summary = await resources.evidence.finishRun(input);

      this.currentState = 'CLOSED';

      return summary;
    } catch {
      this.currentState = 'FAILED';

      await resources.session.close().catch(() => undefined);

      await this.disposeSurface(resources.surface).catch(() => undefined);

      throw new RunCoordinatorError('FINISH_FAILED', 'Run lifecycle finalization failed');
    }
  }

  async fail(result: unknown): Promise<RunEvidenceSummary> {
    this.requireState('ACTIVE');

    this.currentState = 'FINISHING';

    const resources = this.requireResources();

    try {
      await resources.evidence.recordEvent({
        step: 0,
        eventType: 'session_lifecycle',
        result: {
          state: 'FAILED',
          owner: resources.session.owner,
        },
      });

      await resources.session.fail('SESSION_FAILURE');

      await this.disposeSurface(resources.surface).catch(() => undefined);

      const summary = await resources.evidence.finishRun({
        status: 'failure',
        result,
      });

      this.currentState = 'FAILED';

      return summary;
    } catch {
      this.currentState = 'FAILED';

      await resources.session.close().catch(() => undefined);

      await this.disposeSurface(resources.surface).catch(() => undefined);

      throw new RunCoordinatorError('FINISH_FAILED', 'Failed run cleanup did not complete');
    }
  }

  private requireState(expected: RunCoordinatorState): void {
    if (this.currentState !== expected) {
      throw new RunCoordinatorError(
        'INVALID_COORDINATOR_STATE',
        `Expected coordinator state ${expected}, received ${this.currentState}`,
      );
    }
  }

  private requireResources(): ActiveResources<TStrategy> {
    if (this.resources === null) {
      throw new RunCoordinatorError('INVALID_COORDINATOR_STATE', 'Run resources are unavailable');
    }

    return this.resources;
  }

  private async disposeSurface(surface: ManagedSurfaceAdapter<TStrategy>): Promise<void> {
    await surface.dispose?.();
  }
}
