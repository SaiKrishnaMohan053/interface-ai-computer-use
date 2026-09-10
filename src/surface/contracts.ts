/**
 * JSON-compatible values for observations, results, and diagnostics.
 * These values may contain sensitive data until explicitly sanitized.
 */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * ISO 8601 timestamp, validated at runtime boundaries.
 */
export type Timestamp = string;

export interface SurfaceScope {
  readonly sessionId: string;
  readonly surfaceId: string;
}

export interface BoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Describes a control visible in one observation.
 * controlId is observation-local, not a durable replay selector.
 */
interface ObservableControlBase {
  readonly controlId: string;
  readonly name: string;
  readonly role: string | null;
  readonly visible: boolean;
  readonly enabled: boolean;
  readonly bounds: BoundingBox | null;
}

export type ObservableControl = ObservableControlBase &
  (
    | {
        readonly kind: 'button';
      }
    | {
        readonly kind: 'link';
        readonly destination: string | null;
      }
    | {
        readonly kind: 'text_input';
        readonly inputType: 'text' | 'password' | 'email' | 'number' | 'other';
        readonly value: string | null;
        readonly readOnly: boolean;
      }
    | {
        readonly kind: 'select';
        readonly multiple: boolean;
        readonly options: readonly {
          readonly label: string;
          readonly value: string;
          readonly selected: boolean;
          readonly enabled: boolean;
        }[];
      }
    | {
        readonly kind: 'checkbox';
        readonly checked: boolean;
        readonly indeterminate: boolean;
      }
    | {
        readonly kind: 'radio';
        readonly checked: boolean;
      }
    | {
        readonly kind: 'other';
        readonly value: string | null;
      }
  );

/**
 * Native dialogs and rendered interstitials are distinct.
 * Detection does not imply that a dialog is known or safe to dismiss.
 */
export type ObservableDialog =
  | {
      readonly kind: 'native';
      readonly dialogId: string;
      readonly type: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
      readonly message: string;
      readonly defaultValue: string | null;
    }
  | {
      readonly kind: 'surface';
      readonly dialogId: string;
      readonly presentation: 'modal' | 'interstitial';
      readonly title: string | null;
      readonly text: string;
      readonly controlIds: readonly string[];
    };

export interface SurfaceObservation extends SurfaceScope {
  readonly observationId: string;
  readonly capturedAt: Timestamp;

  /**
   * Web surfaces report a URL; other adapters can identify a window/screen.
   */
  readonly location:
    | {
        readonly kind: 'web';
        readonly url: string;
        readonly title: string;
      }
    | {
        readonly kind: 'application';
        readonly applicationId: string;
        readonly windowTitle: string;
      };

  readonly visibleText: string;
  readonly controls: readonly ObservableControl[];
  readonly dialogs: readonly ObservableDialog[];

  /**
   * "complete" requires a defined adapter completion signal.
   * Failure to detect a loading indicator alone is insufficient.
   */
  readonly loading: 'loading' | 'complete' | 'unknown';

  /**
   * Observation collectors must disclose truncation.
   */
  readonly truncated: {
    readonly visibleText: boolean;
    readonly controls: boolean;
  };
}

/**
 * TTarget will be specialized with TargetSpec in the targeting step.
 */
export type SurfaceCondition<TTarget> =
  | {
      readonly kind: 'elementVisible';
      readonly target: TTarget;
    }
  | {
      readonly kind: 'elementAbsent';
      readonly target: TTarget;
    }
  | {
      readonly kind: 'textPresent';
      readonly text: string;
      readonly match: 'exact' | 'contains';
      readonly caseSensitive: boolean;
    }
  | {
      readonly kind: 'urlMatches';
      readonly match:
        | {
            readonly kind: 'exact';
            readonly value: string;
          }
        | {
            readonly kind: 'pathname';
            readonly value: string;
          };
    }
  | {
      readonly kind: 'valueEquals';
      readonly target: TTarget;
      readonly expected: string;
    }
  | {
      readonly kind: 'loadingComplete';
    };

export interface ConditionWaitOptions {
  readonly timeoutMs: number;
  readonly pollIntervalMs: number;
}

/**
 * Action intent only.
 * No policy decision, risk self-classification, or executable code.
 */
export type SurfaceAction<TTarget> =
  | {
      readonly kind: 'click';
      readonly target: TTarget;
    }
  | {
      readonly kind: 'type';
      readonly target: TTarget;
      readonly text: string;
      readonly mode: 'replace' | 'append';
    }
  | {
      readonly kind: 'select';
      readonly target: TTarget;
      readonly option:
        | { readonly kind: 'label'; readonly label: string }
        | { readonly kind: 'value'; readonly value: string };
    }
  | {
      readonly kind: 'check';
      readonly target: TTarget;
    }
  | {
      readonly kind: 'uncheck';
      readonly target: TTarget;
    }
  | {
      readonly kind: 'navigate';
      readonly destination: string;
    }
  | {
      readonly kind: 'read';
      readonly target: TTarget;
      readonly source: 'text' | 'value';
    }
  | {
      readonly kind: 'wait';
      readonly condition: SurfaceCondition<TTarget>;
      readonly options: ConditionWaitOptions;
    }
  | {
      readonly kind: 'dismiss';
      readonly dialog:
        | {
            readonly kind: 'native';
            readonly observationId: string;
            readonly dialogId: string;
            readonly response:
              | { readonly kind: 'dismiss' }
              | { readonly kind: 'accept'; readonly promptText?: string };
          }
        | {
            readonly kind: 'surface';
            readonly target: TTarget;
          };
    };

/**
 * Opaque, short-lived adapter handle.
 * Never serialize this into a reusable capability artifact.
 *
 * The adapter keeps any Locator/accessibility-node implementation privately.
 */
export interface ResolvedTarget extends SurfaceScope {
  readonly resolutionId: string;
  readonly observationId: string;
  readonly resolvedAt: Timestamp;
  readonly description: string;
  readonly matchedStrategyIndex: number;
  readonly cardinality: 'exactly-one';
}

/**
 * Reference to evidence after the recorder's sanitization/persistence process.
 * Declaring this type does not itself sanitize or persist anything.
 */
export interface EvidenceReference {
  readonly evidenceId: string;
  readonly runId: string;
  readonly kind: 'screenshot' | 'trace' | 'snapshot' | 'event_log';
  readonly relativePath: string;
  readonly mediaType: string;
  readonly capturedAt: Timestamp;
}

export type SurfaceFailureCode =
  | 'TARGET_NOT_FOUND'
  | 'TARGET_AMBIGUOUS'
  | 'STALE_TARGET'
  | 'NAVIGATION_FAILED'
  | 'ACTION_FAILED'
  | 'CONDITION_TIMEOUT'
  | 'CONDITION_EVALUATION_FAILED'
  | 'UNSUPPORTED_OPERATION'
  | 'SURFACE_UNAVAILABLE';

export interface SurfaceFailure {
  readonly code: SurfaceFailureCode;
  readonly message: string;
  readonly expected: JsonValue;
  readonly observed: JsonValue;
}

/**
 * Low-level execution result.
 * A successful click is not proof that the business goal succeeded.
 */
interface ActionResultBase extends SurfaceScope {
  readonly actionId: string;
  readonly startedAt: Timestamp;
  readonly finishedAt: Timestamp;
  readonly durationMs: number;
  readonly evidenceRefs: readonly EvidenceReference[];
}

export type ActionResult = ActionResultBase &
  (
    | {
        readonly status: 'success';
        readonly output:
          | { readonly kind: 'none' }
          | {
              readonly kind: 'read';
              readonly source: 'text' | 'value';
              readonly value: string;
            };
      }
    | {
        readonly status: 'failure';
        readonly error: SurfaceFailure;
      }
  );

interface ConditionResultBase extends SurfaceScope {
  readonly conditionId: string;
  readonly startedAt: Timestamp;
  readonly finishedAt: Timestamp;
  readonly durationMs: number;
  readonly attempts: number;
  readonly expected: JsonValue;
  readonly observed: JsonValue;
  readonly evidenceRefs: readonly EvidenceReference[];
}

/**
 * A mismatch is a completed single evaluation that returned false.
 * A timeout means the bounded wait exhausted its time budget.
 * An error means evaluation itself could not complete reliably.
 */
export type ConditionResult = ConditionResultBase &
  (
    | {
        readonly status: 'passed';
        readonly passed: true;
      }
    | {
        readonly status: 'not_met';
        readonly passed: false;
        readonly reason: 'mismatch' | 'timeout';
      }
    | {
        readonly status: 'error';
        readonly passed: false;
        readonly error: SurfaceFailure;
      }
  );
