import type { CapabilityStep } from '../artifact/index.js';

import type { RecoverableCondition } from '../runtime/index.js';

import type { ResolvedTarget, SurfaceAdapter } from '../surface/index.js';

import type { TargetStrategy } from '../targeting/index.js';

import { executeReplayDialogRecovery } from './replay-dialog-recovery.js';

import type { ReplayDialogRecoveryAttempt } from './replay-dialog-recovery.js';

import { TargetResolver } from '../targeting/index.js';

export interface ReplayKnownInterstitialInput {
  readonly adapter: SurfaceAdapter<TargetStrategy>;

  readonly step: CapabilityStep;

  readonly timeoutMs: number;

  readonly signal?: AbortSignal;

  readonly recordAttempt: (attempt: ReplayDialogRecoveryAttempt) => Promise<void>;
}

export type ReplayKnownInterstitialResult =
  | {
      readonly status: 'not_present';
    }
  | {
      readonly status: 'recovered';

      readonly condition: RecoverableCondition;

      readonly attempts: 1;
    }
  | {
      readonly status: 'intervention_required';

      readonly reasonCode: 'HUMAN_APPROVAL_REQUIRED' | 'RECOVERY_EXHAUSTED';

      readonly reason: string;
    }
  | {
      readonly status: 'failure';

      readonly code: string;

      readonly message: string;
    };

const CONTINUE_TARGET = {
  description: 'Continue control on known interstitial',

  cardinality: 'exactly-one',

  strategies: [
    {
      kind: 'role-name',

      role: 'link',

      name: {
        value: 'Continue',

        mode: 'exact',

        caseSensitive: false,
      },
    },
  ],
} as const;

function hasKnownInterstitial(visibleText: string): boolean {
  return visibleText.toLowerCase().includes('scheduled service notice');
}

async function resolveContinueTarget(
  input: ReplayKnownInterstitialInput,
  observationId: string,
): Promise<
  | {
      readonly status: 'resolved';
      readonly target: ResolvedTarget;
    }
  | {
      readonly status: 'failure';
      readonly code: string;
      readonly message: string;
    }
> {
  const resolver = new TargetResolver(input.adapter);

  const result = await resolver.resolve(
    {
      observationId,

      target: CONTINUE_TARGET,
    },

    {
      timeoutMs: input.timeoutMs,

      ...(input.signal === undefined
        ? {}
        : {
            signal: input.signal,
          }),
    },
  );

  if (result.status === 'failure') {
    return {
      status: 'failure',

      code: result.error.code,

      message: result.error.message,
    };
  }

  return {
    status: 'resolved',

    target: result.target,
  };
}

export async function recoverKnownReplayInterstitial(
  input: ReplayKnownInterstitialInput,
): Promise<ReplayKnownInterstitialResult> {
  const observation = await input.adapter.observe({
    timeoutMs: input.timeoutMs,

    maxTextLength: 10_000,

    maxControls: 200,

    ...(input.signal === undefined
      ? {}
      : {
          signal: input.signal,
        }),
  });

  if (observation.status === 'failure') {
    return {
      status: 'failure',

      code: observation.error.code,

      message: observation.error.message,
    };
  }

  if (!hasKnownInterstitial(observation.observation.visibleText)) {
    return {
      status: 'not_present',
    };
  }

  const condition: Extract<
    RecoverableCondition,
    {
      readonly code: 'KNOWN_INTERSTITIAL';
    }
  > = {
    code: 'KNOWN_INTERSTITIAL',

    message: 'Known scheduled-service interstitial detected during replay.',

    detectedAt: new Date().toISOString(),

    details: {
      stepId: input.step.id,
    },

    recovery: 'continue',

    dialogId: 'scheduled-service-notice',
  };

  const recovery = await executeReplayDialogRecovery({
    step: input.step,

    condition,

    dismiss: async () => {
      const current = await input.adapter.observe({
        timeoutMs: input.timeoutMs,

        maxTextLength: 10_000,

        maxControls: 200,

        ...(input.signal === undefined
          ? {}
          : {
              signal: input.signal,
            }),
      });

      if (current.status === 'failure') {
        return {
          status: 'failure',

          code: current.error.code,

          message: current.error.message,
        };
      }

      const resolved = await resolveContinueTarget(input, current.observation.observationId);

      if (resolved.status === 'failure') {
        return resolved;
      }

      const performed = await input.adapter.perform(
        {
          actionId: `${input.step.id}:known-interstitial:continue`,

          action: {
            kind: 'click',

            target: resolved.target,
          },
        },

        {
          timeoutMs: input.timeoutMs,

          ...(input.signal === undefined
            ? {}
            : {
                signal: input.signal,
              }),
        },
      );

      if (performed.status === 'failure') {
        return {
          status: 'failure',

          code: performed.error.code,

          message: performed.error.message,
        };
      }

      return {
        status: 'dismissed',
      };
    },

    verifyGone: async () => {
      const current = await input.adapter.observe({
        timeoutMs: input.timeoutMs,

        maxTextLength: 10_000,

        maxControls: 200,

        ...(input.signal === undefined
          ? {}
          : {
              signal: input.signal,
            }),
      });

      return current.status === 'success' && !hasKnownInterstitial(current.observation.visibleText);
    },

    recordAttempt: input.recordAttempt,
  });

  switch (recovery.status) {
    case 'recovered':
      return {
        status: 'recovered',

        condition,

        attempts: recovery.attempts,
      };

    case 'intervention_required':
      return {
        status: 'intervention_required',

        reasonCode: recovery.intervention.code,

        reason: recovery.intervention.message,
      };

    case 'failure':
      return {
        status: 'failure',

        code: recovery.error.code,

        message: recovery.error.message,
      };
  }
}
