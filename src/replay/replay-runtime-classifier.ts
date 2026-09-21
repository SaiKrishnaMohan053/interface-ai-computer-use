import type {
  InterventionReasonCode,
  RecoverableCondition,
  RuntimeFailureCode,
} from '../runtime/index.js';

import type { JsonValue } from '../surface/index.js';

import type { ReplayDetectedBusinessOutcome } from './replay-business-outcome-detector.js';

export type ReplayRuntimeClassification =
  | {
      readonly category: 'BUSINESS_OUTCOME';
      readonly outcome: ReplayDetectedBusinessOutcome;
    }
  | {
      readonly category: 'RECOVERABLE';
      readonly condition: RecoverableCondition;
    }
  | {
      readonly category: 'INTERVENTION_REQUIRED';
      readonly intervention: {
        readonly code: InterventionReasonCode;
        readonly message: string;
        readonly details: Readonly<Record<string, JsonValue>>;
      };
    }
  | {
      readonly category: 'HARD_FAILURE';
      readonly failure: {
        readonly code: RuntimeFailureCode;
        readonly message: string;
        readonly expected: JsonValue;
        readonly observed: JsonValue;
        readonly details: Readonly<Record<string, JsonValue>>;
      };
    }
  | {
      readonly category: 'NONE';
    };

export type ReplayRuntimeSignal =
  | {
      readonly kind: 'business_outcome';
      readonly outcome: ReplayDetectedBusinessOutcome;
    }
  | {
      readonly kind: 'recoverable';
      readonly condition: RecoverableCondition;
    }
  | {
      readonly kind: 'intervention_required';
      readonly code: InterventionReasonCode;
      readonly message: string;
      readonly details?: Readonly<Record<string, JsonValue>>;
    }
  | {
      readonly kind: 'failure';
      readonly code: RuntimeFailureCode;
      readonly message: string;
      readonly expected: JsonValue;
      readonly observed: JsonValue;
      readonly details?: Readonly<Record<string, JsonValue>>;
    }
  | {
      readonly kind: 'none';
    };

export function classifyReplayRuntimeSignal(
  signal: ReplayRuntimeSignal,
): ReplayRuntimeClassification {
  switch (signal.kind) {
    case 'business_outcome':
      return {
        category: 'BUSINESS_OUTCOME',
        outcome: signal.outcome,
      };

    case 'recoverable':
      return {
        category: 'RECOVERABLE',
        condition: signal.condition,
      };

    case 'intervention_required':
      return {
        category: 'INTERVENTION_REQUIRED',

        intervention: {
          code: signal.code,
          message: signal.message,
          details: signal.details ?? {},
        },
      };

    case 'failure':
      return {
        category: 'HARD_FAILURE',

        failure: {
          code: signal.code,
          message: signal.message,
          expected: signal.expected,
          observed: signal.observed,
          details: signal.details ?? {},
        },
      };

    case 'none':
      return {
        category: 'NONE',
      };
  }
}
