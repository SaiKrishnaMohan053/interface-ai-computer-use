import type { CapabilityStep } from '../artifact/index.js';

import type { RecoverableCondition } from '../runtime/index.js';

import type { JsonValue } from '../surface/index.js';

export interface ReplayDialogRecoveryAttempt {
  readonly stepId: string;
  readonly conditionCode: 'KNOWN_DIALOG' | 'KNOWN_INTERSTITIAL';
  readonly attempt: number;
  readonly outcome: 'started' | 'dismissed' | 'still_present' | 'policy_blocked' | 'failure';
  readonly details: Readonly<Record<string, JsonValue>>;
}

export type ReplayDialogRecoveryResult =
  | {
      readonly status: 'recovered';
      readonly attempts: 1;
    }
  | {
      readonly status: 'intervention_required';

      readonly intervention: {
        readonly code: 'HUMAN_APPROVAL_REQUIRED' | 'RECOVERY_EXHAUSTED';

        readonly message: string;

        readonly details: Readonly<Record<string, JsonValue>>;
      };
    }
  | {
      readonly status: 'failure';

      readonly error: {
        readonly code: string;
        readonly message: string;

        readonly details: Readonly<Record<string, JsonValue>>;
      };
    };

export interface ReplayDialogRecoveryInput {
  readonly step: CapabilityStep;

  readonly condition: Extract<
    RecoverableCondition,
    {
      readonly code: 'KNOWN_DIALOG' | 'KNOWN_INTERSTITIAL';
    }
  >;

  /**
   * Must represent the caller's complete,
   * policy-controlled dismissal path.
   *
   * This helper never bypasses runtime policy
   * and never talks directly to a browser.
   */
  readonly dismiss: () => Promise<
    | {
        readonly status: 'dismissed';
      }
    | {
        readonly status: 'intervention_required';

        readonly code: 'HUMAN_APPROVAL_REQUIRED';

        readonly message: string;
      }
    | {
        readonly status: 'failure';
        readonly code: string;
        readonly message: string;
      }
  >;

  /**
   * Re-observes / re-evaluates the surface
   * after dismissal.
   *
   * true means the recognized dialog or
   * interstitial is no longer present.
   */
  readonly verifyGone: () => Promise<boolean>;

  /**
   * Caller wires this to the run evidence
   * recorder.
   */
  readonly recordAttempt: (attempt: ReplayDialogRecoveryAttempt) => Promise<void>;
}

function hasAuthorizedInterstitialRecovery(step: CapabilityStep): boolean {
  return (
    step.recovery?.some(
      (policy) => policy.kind === 'dismissKnownDialog' && policy.condition === 'KNOWN_INTERSTITIAL',
    ) ?? false
  );
}

/**
 * Executes one explicitly authorized
 * deterministic dialog/interstitial recovery.
 *
 * Current artifact schema authorizes
 * dismissKnownDialog only for
 * KNOWN_INTERSTITIAL.
 *
 * KNOWN_DIALOG therefore remains detectable at
 * runtime but is not silently dismissible.
 */
export async function executeReplayDialogRecovery(
  input: ReplayDialogRecoveryInput,
): Promise<ReplayDialogRecoveryResult> {
  const authorized =
    input.condition.code === 'KNOWN_INTERSTITIAL' && hasAuthorizedInterstitialRecovery(input.step);

  if (!authorized) {
    return {
      status: 'intervention_required',

      intervention: {
        code: 'HUMAN_APPROVAL_REQUIRED',

        message: 'Dialog recovery is not explicitly authorized by the artifact.',

        details: {
          stepId: input.step.id,
          conditionCode: input.condition.code,
        },
      },
    };
  }

  await input.recordAttempt({
    stepId: input.step.id,

    conditionCode: input.condition.code,

    attempt: 1,
    outcome: 'started',
    details: {},
  });

  const dismissResult = await input.dismiss();

  if (dismissResult.status === 'intervention_required') {
    await input.recordAttempt({
      stepId: input.step.id,

      conditionCode: input.condition.code,

      attempt: 1,
      outcome: 'policy_blocked',

      details: {
        code: dismissResult.code,
      },
    });

    return {
      status: 'intervention_required',

      intervention: {
        code: dismissResult.code,

        message: dismissResult.message,

        details: {
          stepId: input.step.id,

          conditionCode: input.condition.code,
        },
      },
    };
  }

  if (dismissResult.status === 'failure') {
    await input.recordAttempt({
      stepId: input.step.id,

      conditionCode: input.condition.code,

      attempt: 1,
      outcome: 'failure',

      details: {
        code: dismissResult.code,
      },
    });

    return {
      status: 'failure',

      error: {
        code: dismissResult.code,

        message: dismissResult.message,

        details: {
          stepId: input.step.id,

          conditionCode: input.condition.code,
        },
      },
    };
  }

  await input.recordAttempt({
    stepId: input.step.id,

    conditionCode: input.condition.code,

    attempt: 1,
    outcome: 'dismissed',
    details: {},
  });

  const gone = await input.verifyGone();

  if (gone) {
    return {
      status: 'recovered',
      attempts: 1,
    };
  }

  await input.recordAttempt({
    stepId: input.step.id,

    conditionCode: input.condition.code,

    attempt: 1,

    outcome: 'still_present',

    details: {},
  });

  return {
    status: 'intervention_required',

    intervention: {
      code: 'RECOVERY_EXHAUSTED',

      message: `Known interstitial remained after deterministic recovery for step "${input.step.id}".`,

      details: {
        stepId: input.step.id,

        conditionCode: input.condition.code,
      },
    },
  };
}
