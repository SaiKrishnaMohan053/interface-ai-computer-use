import type {
  ActionResult,
  ConditionResult,
  ConditionWaitOptions,
  ObservableDialog,
  ResolvedTarget,
  SurfaceAction,
  SurfaceCondition,
  SurfaceFailure,
  SurfaceObservation,
  SurfaceScope,
  Timestamp,
} from './contracts.js';

/**
 * Common execution budget.
 *
 * Implementations must validate positive, finite timeouts and honor cancellation.
 * AbortSignal is runtime-only and must not be persisted.
 */
export interface SurfaceOperationOptions {
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface ObservationOptions extends SurfaceOperationOptions {
  readonly maxTextLength: number;
  readonly maxControls: number;
}

export type ObservationResult =
  | {
      readonly status: 'success';
      readonly observation: SurfaceObservation;
    }
  | {
      readonly status: 'failure';
      readonly error: SurfaceFailure;
    };

/**
 * The adapter resolves one targeting strategy per call.
 *
 * The Target Resolver will own ordered fallback across strategies.
 * TStrategy will be specialized when targeting contracts are implemented.
 */
export interface TargetResolutionRequest<TStrategy> {
  readonly observationId: string;
  readonly description: string;
  readonly strategyIndex: number;
  readonly strategy: TStrategy;
}

export type TargetResolutionResult =
  | {
      readonly status: 'resolved';
      readonly target: ResolvedTarget;
    }
  | {
      readonly status: 'not_found';
      readonly matchCount: 0;
    }
  | {
      readonly status: 'ambiguous';
      readonly matchCount: number;
    }
  | {
      readonly status: 'failure';
      readonly error: SurfaceFailure;
    };

/**
 * A wait is dispatched to evaluate(), not executed as an arbitrary sleep.
 *
 * Target-bearing executable actions use opaque ResolvedTarget handles.
 */
export type ExecutableSurfaceAction = Exclude<
  SurfaceAction<ResolvedTarget>,
  { readonly kind: 'wait' }
>;

export interface ActionExecutionRequest {
  readonly actionId: string;
  readonly action: ExecutableSurfaceAction;
}

/**
 * An absence check must represent a successful zero-match resolution.
 * It cannot be represented by inventing a ResolvedTarget.
 */
export type ConditionTarget =
  | {
      readonly kind: 'resolved';
      readonly target: ResolvedTarget;
    }
  | {
      readonly kind: 'absent';
      readonly observationId: string;
    };

/**
 * The evaluator obtains fresh target information for each polling attempt.
 *
 * The caller supplies targeting orchestration without exposing browser objects.
 * For ambiguity or resolution failure, return failure, never "absent".
 */
export type ConditionPreparationResult =
  | {
      readonly status: 'ready';
      readonly condition: SurfaceCondition<ConditionTarget>;
    }
  | {
      readonly status: 'failure';
      readonly error: SurfaceFailure;
    };

export interface ConditionEvaluationRequest {
  readonly conditionId: string;
  readonly prepare: (options: SurfaceOperationOptions) => Promise<ConditionPreparationResult>;
}

/**
 * Raw evidence is transient and potentially sensitive.
 *
 * No output path or EvidenceReference is accepted here.
 * The recorder must sanitize before writing any bytes to storage.
 */
export type EvidenceCaptureRequest =
  | {
      readonly kind: 'screenshot';
      readonly extent: 'viewport' | 'full_surface';
    }
  | {
      readonly kind: 'snapshot';
    };

interface CapturedEvidenceBase extends SurfaceScope {
  readonly capturedAt: Timestamp;
}

export type CapturedEvidence = CapturedEvidenceBase &
  (
    | {
        readonly kind: 'screenshot';
        readonly mediaType: 'image/png';
        readonly bytes: Uint8Array;
      }
    | {
        readonly kind: 'snapshot';
        readonly mediaType: 'application/json';
        readonly observation: SurfaceObservation;
      }
  );

export type EvidenceCaptureResult =
  | {
      readonly status: 'success';
      readonly evidence: CapturedEvidence;
    }
  | {
      readonly status: 'failure';
      readonly error: SurfaceFailure;
    };

/**
 * Surface-neutral perception and execution boundary.
 *
 * No LLM, policy evaluation, capability artifacts, or replay orchestration.
 * No browser lifecycle ownership.
 */
export interface SurfaceAdapter<TStrategy> {
  readonly scope: SurfaceScope;

  observe(options: ObservationOptions): Promise<ObservationResult>;

  resolveTarget(
    request: TargetResolutionRequest<TStrategy>,
    options: SurfaceOperationOptions,
  ): Promise<TargetResolutionResult>;

  perform(request: ActionExecutionRequest, options: SurfaceOperationOptions): Promise<ActionResult>;

  evaluate(
    request: ConditionEvaluationRequest,
    options: ConditionWaitOptions & { readonly signal?: AbortSignal },
  ): Promise<ConditionResult>;

  captureEvidence(
    request: EvidenceCaptureRequest,
    options: SurfaceOperationOptions,
  ): Promise<EvidenceCaptureResult>;
}

/**
 * Convenience type for adapters that maintain pending native-dialog handles.
 * Only the adapter owns the actual platform dialog object.
 */
export type NativeDialogObservation = Extract<ObservableDialog, { readonly kind: 'native' }>;
