import { describe, expect, it, vi } from 'vitest';

import { executeReplayDialogRecovery } from '../../src/replay/index.js';

import type { ReplayDialogRecoveryAttempt } from '../../src/replay/index.js';

import type { CapabilityStep } from '../../src/artifact/index.js';

import type { RecoverableCondition } from '../../src/runtime/index.js';

function knownInterstitial(): Extract<
  RecoverableCondition,
  { readonly code: 'KNOWN_INTERSTITIAL' }
> {
  return {
    code: 'KNOWN_INTERSTITIAL',
    message: 'Known application interstitial detected.',
    detectedAt: '2026-09-20T21:00:00.000Z',

    details: {
      stepId: 'submit-member-search',
    },

    recovery: 'continue',
    dialogId: 'interstitial-1',
  };
}

function knownDialog(): Extract<RecoverableCondition, { readonly code: 'KNOWN_DIALOG' }> {
  return {
    code: 'KNOWN_DIALOG',
    message: 'Known dialog detected.',
    detectedAt: '2026-09-20T21:00:00.000Z',

    details: {
      stepId: 'submit-member-search',
    },

    recovery: 'dismiss',
    dialogId: 'dialog-1',
  };
}

function step(recovery?: CapabilityStep['recovery']): CapabilityStep {
  return {
    id: 'submit-member-search',
    description: 'Submit member search.',

    action: {
      kind: 'click',
    },

    target: {
      description: 'Search button',
      cardinality: 'exactly-one',

      strategies: [
        {
          kind: 'role-name',
          role: 'button',

          name: {
            value: 'Search',
            mode: 'exact',
            caseSensitive: false,
          },
        },
      ],
    },

    ...(recovery === undefined
      ? {}
      : {
          recovery,
        }),

    risk: 'READ_ONLY',
  };
}

function interstitialRecovery(): NonNullable<CapabilityStep['recovery']>[number] {
  return {
    kind: 'dismissKnownDialog',
    condition: 'KNOWN_INTERSTITIAL',
  };
}

function transientRecovery(): NonNullable<CapabilityStep['recovery']>[number] {
  return {
    kind: 'retry',
    condition: 'TRANSIENT_LOAD',
    maxAttempts: 2,
  };
}

function callbacks() {
  return {
    dismiss: vi.fn<
      () => Promise<
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
      >
    >(() =>
      Promise.resolve({
        status: 'dismissed',
      }),
    ),

    verifyGone: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)),

    recordAttempt: vi.fn<(attempt: ReplayDialogRecoveryAttempt) => Promise<void>>(() =>
      Promise.resolve(),
    ),
  };
}

describe('replay dialog recovery', () => {
  it('dismisses a known interstitial with a matching recovery rule and recovers after verification', async () => {
    const { dismiss, verifyGone, recordAttempt } = callbacks();

    const result = await executeReplayDialogRecovery({
      step: step([interstitialRecovery()]),

      condition: knownInterstitial(),

      dismiss,
      verifyGone,
      recordAttempt,
    });

    expect(result.status).toBe('recovered');

    if (result.status === 'recovered') {
      expect(result.attempts).toBe(1);
    }

    expect(dismiss).toHaveBeenCalledTimes(1);

    expect(verifyGone).toHaveBeenCalledTimes(1);
  });

  it('requires intervention for KNOWN_DIALOG when the artifact has no explicit matching recovery rule', async () => {
    const { dismiss, verifyGone, recordAttempt } = callbacks();

    const result = await executeReplayDialogRecovery({
      step: step([interstitialRecovery()]),

      condition: knownDialog(),

      dismiss,
      verifyGone,
      recordAttempt,
    });

    expect(result.status).toBe('intervention_required');

    if (result.status === 'intervention_required') {
      expect(result.intervention.code).toBe('HUMAN_APPROVAL_REQUIRED');
    }

    expect(dismiss).not.toHaveBeenCalled();

    expect(verifyGone).not.toHaveBeenCalled();

    expect(recordAttempt).not.toHaveBeenCalled();
  });

  it('requires intervention when no matching recovery rule exists for the detected interstitial', async () => {
    const { dismiss, verifyGone, recordAttempt } = callbacks();

    const result = await executeReplayDialogRecovery({
      step: step([transientRecovery()]),

      condition: knownInterstitial(),

      dismiss,
      verifyGone,
      recordAttempt,
    });

    expect(result.status).toBe('intervention_required');

    if (result.status === 'intervention_required') {
      expect(result.intervention.code).toBe('HUMAN_APPROVAL_REQUIRED');

      expect(result.intervention.details.conditionCode).toBe('KNOWN_INTERSTITIAL');
    }

    expect(dismiss).not.toHaveBeenCalled();

    expect(verifyGone).not.toHaveBeenCalled();
  });

  it('returns HUMAN_APPROVAL_REQUIRED when dismiss policy requires human approval', async () => {
    const { dismiss, verifyGone, recordAttempt } = callbacks();

    dismiss.mockResolvedValue({
      status: 'intervention_required',
      code: 'HUMAN_APPROVAL_REQUIRED',
      message: 'Runtime policy requires human approval before dismissal.',
    });

    const result = await executeReplayDialogRecovery({
      step: step([interstitialRecovery()]),

      condition: knownInterstitial(),

      dismiss,
      verifyGone,
      recordAttempt,
    });

    expect(result.status).toBe('intervention_required');

    if (result.status === 'intervention_required') {
      expect(result.intervention.code).toBe('HUMAN_APPROVAL_REQUIRED');

      expect(result.intervention.message).toBe(
        'Runtime policy requires human approval before dismissal.',
      );
    }

    expect(dismiss).toHaveBeenCalledTimes(1);

    expect(verifyGone).not.toHaveBeenCalled();
  });

  it('returns failure when the policy-approved dismiss action fails', async () => {
    const { dismiss, verifyGone, recordAttempt } = callbacks();

    dismiss.mockResolvedValue({
      status: 'failure',
      code: 'ACTION_FAILED',
      message: 'Known interstitial dismissal failed.',
    });

    const result = await executeReplayDialogRecovery({
      step: step([interstitialRecovery()]),

      condition: knownInterstitial(),

      dismiss,
      verifyGone,
      recordAttempt,
    });

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('ACTION_FAILED');

      expect(result.error.message).toBe('Known interstitial dismissal failed.');
    }

    expect(dismiss).toHaveBeenCalledTimes(1);

    expect(verifyGone).not.toHaveBeenCalled();
  });

  it('returns RECOVERY_EXHAUSTED when dismissal succeeds but the interstitial remains present', async () => {
    const { dismiss, verifyGone, recordAttempt } = callbacks();

    dismiss.mockResolvedValue({
      status: 'dismissed',
    });

    verifyGone.mockResolvedValue(false);

    const result = await executeReplayDialogRecovery({
      step: step([interstitialRecovery()]),

      condition: knownInterstitial(),

      dismiss,
      verifyGone,
      recordAttempt,
    });

    expect(result.status).toBe('intervention_required');

    if (result.status === 'intervention_required') {
      expect(result.intervention.code).toBe('RECOVERY_EXHAUSTED');

      expect(result.intervention.details.conditionCode).toBe('KNOWN_INTERSTITIAL');
    }

    expect(dismiss).toHaveBeenCalledTimes(1);

    expect(verifyGone).toHaveBeenCalledTimes(1);
  });

  it('records started and dismissed recovery attempt states', async () => {
    const { dismiss, verifyGone, recordAttempt } = callbacks();

    await executeReplayDialogRecovery({
      step: step([interstitialRecovery()]),

      condition: knownInterstitial(),

      dismiss,
      verifyGone,
      recordAttempt,
    });

    expect(recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        stepId: 'submit-member-search',
        conditionCode: 'KNOWN_INTERSTITIAL',
        attempt: 1,
        outcome: 'started',
      }),
    );

    expect(recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        stepId: 'submit-member-search',
        conditionCode: 'KNOWN_INTERSTITIAL',
        attempt: 1,
        outcome: 'dismissed',
      }),
    );
  });

  it('records still_present when dismissal succeeds but verification fails', async () => {
    const { dismiss, verifyGone, recordAttempt } = callbacks();

    verifyGone.mockResolvedValue(false);

    await executeReplayDialogRecovery({
      step: step([interstitialRecovery()]),

      condition: knownInterstitial(),

      dismiss,
      verifyGone,
      recordAttempt,
    });

    expect(recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        outcome: 'started',
      }),
    );

    expect(recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        outcome: 'dismissed',
      }),
    );

    expect(recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        outcome: 'still_present',
      }),
    );
  });

  it('records policy_blocked when dismissal is not permitted by runtime policy', async () => {
    const { dismiss, verifyGone, recordAttempt } = callbacks();

    dismiss.mockResolvedValue({
      status: 'intervention_required',
      code: 'HUMAN_APPROVAL_REQUIRED',
      message: 'Human approval required.',
    });

    await executeReplayDialogRecovery({
      step: step([interstitialRecovery()]),

      condition: knownInterstitial(),

      dismiss,
      verifyGone,
      recordAttempt,
    });

    expect(recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        outcome: 'started',
      }),
    );

    expect(recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        outcome: 'policy_blocked',
      }),
    );

    expect(verifyGone).not.toHaveBeenCalled();
  });

  it('records failure when the authorized dismiss action itself fails', async () => {
    const { dismiss, verifyGone, recordAttempt } = callbacks();

    dismiss.mockResolvedValue({
      status: 'failure',
      code: 'ACTION_FAILED',
      message: 'Dismiss failed.',
    });

    await executeReplayDialogRecovery({
      step: step([interstitialRecovery()]),

      condition: knownInterstitial(),

      dismiss,
      verifyGone,
      recordAttempt,
    });

    expect(recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        outcome: 'failure',
      }),
    );

    expect(verifyGone).not.toHaveBeenCalled();
  });

  it('never dismisses blindly when the artifact contains no recovery metadata', async () => {
    const { dismiss, verifyGone, recordAttempt } = callbacks();

    const result = await executeReplayDialogRecovery({
      step: step(),

      condition: knownInterstitial(),

      dismiss,
      verifyGone,
      recordAttempt,
    });

    expect(result.status).toBe('intervention_required');

    expect(dismiss).not.toHaveBeenCalled();

    expect(verifyGone).not.toHaveBeenCalled();

    expect(recordAttempt).not.toHaveBeenCalled();
  });

  it('never dismisses KNOWN_DIALOG using a KNOWN_INTERSTITIAL recovery rule', async () => {
    const { dismiss, verifyGone, recordAttempt } = callbacks();

    const result = await executeReplayDialogRecovery({
      step: step([interstitialRecovery()]),

      condition: knownDialog(),

      dismiss,
      verifyGone,
      recordAttempt,
    });

    expect(result.status).toBe('intervention_required');

    expect(dismiss).not.toHaveBeenCalled();

    expect(verifyGone).not.toHaveBeenCalled();
  });
});
