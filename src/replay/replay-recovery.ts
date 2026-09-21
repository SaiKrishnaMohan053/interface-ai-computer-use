import type { CapabilityStep, RecoveryPolicy, WaitPolicy } from '../artifact/index.js';

import type { RecoverableCondition } from '../runtime/index.js';

import type { JsonValue } from '../surface/index.js';

const DEFAULT_RECOVERY_WAIT: WaitPolicy = {
  timeoutMs: 5_000,
  pollIntervalMs: 100,
};

export interface ReplayRecoveryAttemptRecord {
  readonly stepId: string;
  readonly conditionCode: RecoverableCondition['code'];
  readonly recoveryKind: RecoveryPolicy['kind'];
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly outcome: 'started' | 'recovered' | 'retry_failed' | 'exhausted';
  readonly details: Readonly<Record<string, JsonValue>>;
}

export type ReplayRecoveryRetryResult =
  | {
      readonly status: 'recovered';
    }
  | {
      readonly status: 'still_recoverable';
      readonly condition: RecoverableCondition;
    }
  | {
      readonly status: 'failure';
      readonly code: string;
      readonly message: string;
      readonly details?: Readonly<Record<string, JsonValue>>;
    };

export type ReplayRecoveryResult =
  | {
      readonly status: 'recovered';
      readonly attempts: number;
      readonly condition: RecoverableCondition;
    }
  | {
      readonly status: 'not_authorized';
      readonly condition: RecoverableCondition;
      readonly reason: 'NO_RECOVERY_METADATA' | 'NO_MATCHING_RECOVERY_POLICY';
    }
  | {
      readonly status: 'intervention_required';
      readonly intervention: {
        readonly code: 'RECOVERY_EXHAUSTED';
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

export interface ReplayRecoveryInput {
  readonly step: CapabilityStep;
  readonly condition: RecoverableCondition;

  /**
   * Called before each retry.
   *
   * The implementation must use bounded deterministic synchronization
   * such as ConditionEvaluator. This recovery layer never sleeps
   * arbitrarily.
   */
  readonly waitBeforeRetry: (wait: WaitPolicy, attempt: number) => Promise<void>;

  /**
   * Re-executes only the explicitly allowed step/checkpoint.
   * It must not invent another action or workflow.
   */
  readonly retry: (attempt: number) => Promise<ReplayRecoveryRetryResult>;

  /**
   * The ReplayStepExecutor will wire this to EvidenceRecorder.
   * Every attempted recovery passes through this callback.
   */
  readonly recordAttempt: (record: ReplayRecoveryAttemptRecord) => Promise<void>;
}

function matchingPolicy(
  step: CapabilityStep,
  condition: RecoverableCondition,
): RecoveryPolicy | undefined {
  const recovery = step.recovery;

  if (recovery === undefined || recovery.length === 0) {
    return undefined;
  }

  switch (condition.code) {
    case 'TRANSIENT_LOAD':
      return recovery.find(
        (policy): policy is Extract<RecoveryPolicy, { readonly kind: 'retry' }> =>
          policy.kind === 'retry' && policy.condition === 'TRANSIENT_LOAD',
      );

    case 'KNOWN_INTERSTITIAL':
      return recovery.find(
        (
          policy,
        ): policy is Extract<
          RecoveryPolicy,
          {
            readonly kind: 'dismissKnownDialog';
          }
        > => policy.kind === 'dismissKnownDialog' && policy.condition === 'KNOWN_INTERSTITIAL',
      );

    /*
     * Runtime knows KNOWN_DIALOG, but current artifact schema has
     * no policy that authorizes it.
     */
    case 'KNOWN_DIALOG':
      return undefined;
  }
}

async function executeTransientLoadRecovery(
  input: ReplayRecoveryInput,
  policy: Extract<RecoveryPolicy, { readonly kind: 'retry' }>,
): Promise<ReplayRecoveryResult> {
  const wait = policy.wait ?? DEFAULT_RECOVERY_WAIT;

  let currentCondition = input.condition;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    await input.recordAttempt({
      stepId: input.step.id,
      conditionCode: currentCondition.code,
      recoveryKind: policy.kind,
      attempt,
      maxAttempts: policy.maxAttempts,
      outcome: 'started',
      details: {
        waitTimeoutMs: wait.timeoutMs,
        pollIntervalMs: wait.pollIntervalMs,
      },
    });

    await input.waitBeforeRetry(wait, attempt);

    const result = await input.retry(attempt);

    if (result.status === 'recovered') {
      await input.recordAttempt({
        stepId: input.step.id,
        conditionCode: currentCondition.code,
        recoveryKind: policy.kind,
        attempt,
        maxAttempts: policy.maxAttempts,
        outcome: 'recovered',
        details: {},
      });

      return {
        status: 'recovered',
        attempts: attempt,
        condition: currentCondition,
      };
    }

    if (result.status === 'failure') {
      await input.recordAttempt({
        stepId: input.step.id,
        conditionCode: currentCondition.code,
        recoveryKind: policy.kind,
        attempt,
        maxAttempts: policy.maxAttempts,
        outcome: 'retry_failed',
        details: {
          failureCode: result.code,
        },
      });

      return {
        status: 'failure',
        error: {
          code: result.code,
          message: result.message,
          details: result.details ?? {},
        },
      };
    }

    currentCondition = result.condition;

    if (attempt === policy.maxAttempts) {
      await input.recordAttempt({
        stepId: input.step.id,
        conditionCode: currentCondition.code,
        recoveryKind: policy.kind,
        attempt,
        maxAttempts: policy.maxAttempts,
        outcome: 'exhausted',
        details: {},
      });
    }
  }

  return {
    status: 'intervention_required',

    intervention: {
      code: 'RECOVERY_EXHAUSTED',

      message: `Recovery attempts were exhausted for step "${input.step.id}".`,

      details: {
        stepId: input.step.id,
        conditionCode: currentCondition.code,
        recoveryKind: policy.kind,
        maxAttempts: policy.maxAttempts,
      },
    },
  };
}

async function executeKnownInterstitialRecovery(
  input: ReplayRecoveryInput,
  policy: Extract<
    RecoveryPolicy,
    {
      readonly kind: 'dismissKnownDialog';
    }
  >,
): Promise<ReplayRecoveryResult> {
  /*
   * This policy permits exactly one deterministic recovery action.
   * The concrete retry callback owns the bounded dismissal/checkpoint
   * implementation.
   */
  const attempt = 1;

  await input.recordAttempt({
    stepId: input.step.id,
    conditionCode: input.condition.code,
    recoveryKind: policy.kind,
    attempt,
    maxAttempts: 1,
    outcome: 'started',
    details: {},
  });

  const result = await input.retry(attempt);

  if (result.status === 'recovered') {
    await input.recordAttempt({
      stepId: input.step.id,
      conditionCode: input.condition.code,
      recoveryKind: policy.kind,
      attempt,
      maxAttempts: 1,
      outcome: 'recovered',
      details: {},
    });

    return {
      status: 'recovered',
      attempts: 1,
      condition: input.condition,
    };
  }

  if (result.status === 'failure') {
    await input.recordAttempt({
      stepId: input.step.id,
      conditionCode: input.condition.code,
      recoveryKind: policy.kind,
      attempt,
      maxAttempts: 1,
      outcome: 'retry_failed',
      details: {
        failureCode: result.code,
      },
    });

    return {
      status: 'failure',

      error: {
        code: result.code,
        message: result.message,
        details: result.details ?? {},
      },
    };
  }

  await input.recordAttempt({
    stepId: input.step.id,
    conditionCode: result.condition.code,
    recoveryKind: policy.kind,
    attempt,
    maxAttempts: 1,
    outcome: 'exhausted',
    details: {},
  });

  return {
    status: 'intervention_required',

    intervention: {
      code: 'RECOVERY_EXHAUSTED',

      message: `Known interstitial recovery was exhausted for step "${input.step.id}".`,

      details: {
        stepId: input.step.id,
        conditionCode: result.condition.code,
        recoveryKind: policy.kind,
        maxAttempts: 1,
      },
    },
  };
}

export async function executeReplayRecovery(
  input: ReplayRecoveryInput,
): Promise<ReplayRecoveryResult> {
  const recovery = input.step.recovery;

  if (recovery === undefined || recovery.length === 0) {
    return {
      status: 'not_authorized',
      condition: input.condition,
      reason: 'NO_RECOVERY_METADATA',
    };
  }

  const policy = matchingPolicy(input.step, input.condition);

  if (policy === undefined) {
    return {
      status: 'not_authorized',
      condition: input.condition,
      reason: 'NO_MATCHING_RECOVERY_POLICY',
    };
  }

  switch (policy.kind) {
    case 'retry':
      return executeTransientLoadRecovery(input, policy);

    case 'dismissKnownDialog':
      return executeKnownInterstitialRecovery(input, policy);
  }
}
