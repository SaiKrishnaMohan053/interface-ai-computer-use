import { describe, expect, it, vi } from 'vitest';

import { executeReplayRecoveryFlow } from '../../src/replay/index.js';

describe('replay recovery flow', () => {
  it('recovers from TRANSIENT_LOAD within the bounded retry budget and continues replay', async () => {
    const attemptRecovery = vi.fn((attempt: number) =>
      Promise.resolve(
        attempt === 2
          ? {
              status: 'recovered' as const,
            }
          : {
              status: 'still_recoverable' as const,
            },
      ),
    );

    const continueReplay = vi.fn(() =>
      Promise.resolve({
        savingsBalance: '$12,840.50',
      }),
    );

    const result = await executeReplayRecoveryFlow({
      condition: 'TRANSIENT_LOAD',

      maxAttempts: 3,

      attemptRecovery,

      continueReplay,
    });

    expect(attemptRecovery).toHaveBeenCalledTimes(2);

    expect(attemptRecovery.mock.calls).toEqual([[1], [2]]);

    expect(continueReplay).toHaveBeenCalledTimes(1);

    expect(result).toEqual({
      status: 'success',

      result: {
        savingsBalance: '$12,840.50',
      },

      recoveryAttempts: 2,
    });
  });

  it('safely recovers a KNOWN_INTERSTITIAL and continues replay', async () => {
    const dismissKnownInterstitial = vi.fn(() =>
      Promise.resolve({
        status: 'recovered' as const,
      }),
    );

    const continueReplay = vi.fn(() => Promise.resolve('continued'));

    const result = await executeReplayRecoveryFlow({
      condition: 'KNOWN_INTERSTITIAL',

      maxAttempts: 1,

      attemptRecovery: dismissKnownInterstitial,

      continueReplay,
    });

    expect(dismissKnownInterstitial).toHaveBeenCalledTimes(1);

    expect(continueReplay).toHaveBeenCalledTimes(1);

    expect(result).toEqual({
      status: 'success',

      result: 'continued',

      recoveryAttempts: 1,
    });
  });

  it('returns RECOVERY_EXHAUSTED when the maximum recovery attempts are reached', async () => {
    const attemptRecovery = vi.fn(() =>
      Promise.resolve({
        status: 'still_recoverable' as const,
      }),
    );

    const continueReplay = vi.fn(() => Promise.resolve('must-not-run'));

    const result = await executeReplayRecoveryFlow({
      condition: 'TRANSIENT_LOAD',

      maxAttempts: 2,

      attemptRecovery,

      continueReplay,
    });

    expect(attemptRecovery).toHaveBeenCalledTimes(2);

    expect(continueReplay).not.toHaveBeenCalled();

    expect(result).toEqual({
      status: 'intervention_required',

      intervention: {
        code: 'RECOVERY_EXHAUSTED',

        condition: 'TRANSIENT_LOAD',

        attempts: 2,

        message: 'Recovery for TRANSIENT_LOAD exhausted after 2 attempts.',
      },
    });
  });

  it('fails immediately if an authorized recovery action itself fails', async () => {
    const continueReplay = vi.fn();

    const result = await executeReplayRecoveryFlow({
      condition: 'KNOWN_INTERSTITIAL',

      maxAttempts: 1,

      attemptRecovery: () =>
        Promise.resolve({
          status: 'failed',

          message: 'Known interstitial dismissal failed.',
        }),

      continueReplay,
    });

    expect(result).toEqual({
      status: 'failure',

      error: {
        code: 'ACTION_FAILED',

        message: 'Known interstitial dismissal failed.',
      },
    });

    expect(continueReplay).not.toHaveBeenCalled();
  });

  it('rejects an invalid recovery budget', async () => {
    await expect(
      executeReplayRecoveryFlow({
        condition: 'TRANSIENT_LOAD',

        maxAttempts: 0,

        attemptRecovery: () =>
          Promise.resolve({
            status: 'recovered',
          }),

        continueReplay: () => Promise.resolve(),
      }),
    ).rejects.toThrow('Replay recovery maxAttempts must be a positive integer');
  });
});
