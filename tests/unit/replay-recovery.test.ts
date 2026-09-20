import { describe, expect, it, vi } from 'vitest';

import { executeReplayRecovery } from '../../src/replay/index.js';

import type { ReplayRecoveryAttemptRecord } from '../../src/replay/index.js';

import type { CapabilityStep } from '../../src/artifact/index.js';

import type { RecoverableCondition } from '../../src/runtime/index.js';

function transientLoad(
  overrides: Partial<Extract<RecoverableCondition, { readonly code: 'TRANSIENT_LOAD' }>> = {},
): Extract<RecoverableCondition, { readonly code: 'TRANSIENT_LOAD' }> {
  return {
    code: 'TRANSIENT_LOAD',
    message: 'The application is still loading.',
    detectedAt: '2026-09-20T21:00:00.000Z',

    details: {
      stepId: 'submit-member-search',
    },

    recovery: 'wait-and-retry',
    attempt: 1,
    maxAttempts: 2,

    ...overrides,
  };
}

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

function step(
  options: {
    readonly recovery?: CapabilityStep['recovery'];
  } = {},
): CapabilityStep {
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

    ...(options.recovery === undefined
      ? {}
      : {
          recovery: options.recovery,
        }),

    risk: 'READ_ONLY',
  };
}

function retryRecovery(
  maxAttempts = 2,
  wait?: {
    readonly timeoutMs: number;
    readonly pollIntervalMs: number;
  },
): NonNullable<CapabilityStep['recovery']>[number] {
  return {
    kind: 'retry',
    condition: 'TRANSIENT_LOAD',
    maxAttempts,

    ...(wait === undefined
      ? {}
      : {
          wait,
        }),
  };
}

function interstitialRecovery(): NonNullable<CapabilityStep['recovery']>[number] {
  return {
    kind: 'dismissKnownDialog',
    condition: 'KNOWN_INTERSTITIAL',
  };
}

function callbacks() {
  return {
    waitBeforeRetry: vi.fn<
      (
        wait: {
          readonly timeoutMs: number;
          readonly pollIntervalMs: number;
        },
        attempt: number,
      ) => Promise<void>
    >(() => Promise.resolve()),

    retry: vi.fn<
      (attempt: number) => Promise<
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
            readonly details?: Readonly<Record<string, string>>;
          }
      >
    >(() =>
      Promise.resolve({
        status: 'recovered',
      }),
    ),

    recordAttempt: vi.fn<(record: ReplayRecoveryAttemptRecord) => Promise<void>>(() =>
      Promise.resolve(),
    ),
  };
}

describe('replay recovery', () => {
  it('returns not_authorized when a step has no recovery metadata', async () => {
    const { waitBeforeRetry, retry, recordAttempt } = callbacks();

    const condition = transientLoad();

    const result = await executeReplayRecovery({
      step: step(),
      condition,
      waitBeforeRetry,
      retry,
      recordAttempt,
    });

    expect(result).toEqual({
      status: 'not_authorized',
      condition,
      reason: 'NO_RECOVERY_METADATA',
    });

    expect(retry).not.toHaveBeenCalled();

    expect(waitBeforeRetry).not.toHaveBeenCalled();

    expect(recordAttempt).not.toHaveBeenCalled();
  });

  it('executes bounded recovery for TRANSIENT_LOAD with matching retry metadata', async () => {
    const { waitBeforeRetry, retry, recordAttempt } = callbacks();

    const result = await executeReplayRecovery({
      step: step({
        recovery: [retryRecovery(2)],
      }),

      condition: transientLoad(),
      waitBeforeRetry,
      retry,
      recordAttempt,
    });

    expect(result.status).toBe('recovered');

    expect(retry).toHaveBeenCalledTimes(1);

    expect(waitBeforeRetry).toHaveBeenCalledTimes(1);
  });

  it('recovers on the first retry and reports attempts = 1', async () => {
    const { waitBeforeRetry, retry, recordAttempt } = callbacks();

    retry.mockResolvedValue({
      status: 'recovered',
    });

    const result = await executeReplayRecovery({
      step: step({
        recovery: [retryRecovery(2)],
      }),

      condition: transientLoad(),
      waitBeforeRetry,
      retry,
      recordAttempt,
    });

    expect(result.status).toBe('recovered');

    if (result.status === 'recovered') {
      expect(result.attempts).toBe(1);
    }

    expect(retry).toHaveBeenCalledTimes(1);

    expect(waitBeforeRetry).toHaveBeenCalledTimes(1);
  });

  it('recovers on the second retry after the first remains recoverable', async () => {
    const { waitBeforeRetry, retry, recordAttempt } = callbacks();

    retry
      .mockResolvedValueOnce({
        status: 'still_recoverable',

        condition: transientLoad({
          attempt: 1,
          maxAttempts: 2,
        }),
      })
      .mockResolvedValueOnce({
        status: 'recovered',
      });

    const result = await executeReplayRecovery({
      step: step({
        recovery: [retryRecovery(2)],
      }),

      condition: transientLoad(),
      waitBeforeRetry,
      retry,
      recordAttempt,
    });

    expect(result.status).toBe('recovered');

    if (result.status === 'recovered') {
      expect(result.attempts).toBe(2);
    }

    expect(retry).toHaveBeenCalledTimes(2);

    expect(waitBeforeRetry).toHaveBeenCalledTimes(2);
  });

  it('returns RECOVERY_EXHAUSTED when every allowed retry remains recoverable', async () => {
    const { waitBeforeRetry, retry, recordAttempt } = callbacks();

    retry.mockImplementation((attempt) =>
      Promise.resolve({
        status: 'still_recoverable',

        condition: transientLoad({
          attempt,
          maxAttempts: 2,
        }),
      }),
    );

    const result = await executeReplayRecovery({
      step: step({
        recovery: [retryRecovery(2)],
      }),

      condition: transientLoad(),
      waitBeforeRetry,
      retry,
      recordAttempt,
    });

    expect(result.status).toBe('intervention_required');

    if (result.status === 'intervention_required') {
      expect(result.intervention.code).toBe('RECOVERY_EXHAUSTED');

      expect(result.intervention.details.maxAttempts).toBe(2);
    }

    expect(retry).toHaveBeenCalledTimes(2);

    expect(waitBeforeRetry).toHaveBeenCalledTimes(2);
  });

  it('returns a hard retry failure immediately and does not continue retrying', async () => {
    const { waitBeforeRetry, retry, recordAttempt } = callbacks();

    retry.mockResolvedValue({
      status: 'failure',
      code: 'APPLICATION_ERROR',

      message: 'Application entered a hard error state.',

      details: {
        phase: 'retry',
      },
    });

    const result = await executeReplayRecovery({
      step: step({
        recovery: [retryRecovery(3)],
      }),

      condition: transientLoad({
        maxAttempts: 3,
      }),

      waitBeforeRetry,
      retry,
      recordAttempt,
    });

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('APPLICATION_ERROR');

      expect(result.error.message).toBe('Application entered a hard error state.');
    }

    expect(retry).toHaveBeenCalledTimes(1);

    expect(waitBeforeRetry).toHaveBeenCalledTimes(1);
  });

  it('strictly respects maxAttempts and never performs attempt N + 1', async () => {
    const { waitBeforeRetry, retry, recordAttempt } = callbacks();

    retry.mockImplementation((attempt) =>
      Promise.resolve({
        status: 'still_recoverable',

        condition: transientLoad({
          attempt,
          maxAttempts: 2,
        }),
      }),
    );

    await executeReplayRecovery({
      step: step({
        recovery: [retryRecovery(2)],
      }),

      condition: transientLoad(),
      waitBeforeRetry,
      retry,
      recordAttempt,
    });

    expect(retry).toHaveBeenCalledTimes(2);

    expect(retry).toHaveBeenNthCalledWith(1, 1);

    expect(retry).toHaveBeenNthCalledWith(2, 2);

    expect(retry).not.toHaveBeenCalledWith(3);

    expect(waitBeforeRetry).toHaveBeenCalledTimes(2);
  });

  it('records started and recovered evidence for a successful retry', async () => {
    const { waitBeforeRetry, retry, recordAttempt } = callbacks();

    retry.mockResolvedValue({
      status: 'recovered',
    });

    await executeReplayRecovery({
      step: step({
        recovery: [retryRecovery(2)],
      }),

      condition: transientLoad(),
      waitBeforeRetry,
      retry,
      recordAttempt,
    });

    expect(recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        maxAttempts: 2,
        outcome: 'started',
      }),
    );

    expect(recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        maxAttempts: 2,
        outcome: 'recovered',
      }),
    );
  });

  it('records exhausted evidence on the final unsuccessful retry', async () => {
    const { waitBeforeRetry, retry, recordAttempt } = callbacks();

    retry.mockImplementation((attempt) =>
      Promise.resolve({
        status: 'still_recoverable',

        condition: transientLoad({
          attempt,
          maxAttempts: 2,
        }),
      }),
    );

    const result = await executeReplayRecovery({
      step: step({
        recovery: [retryRecovery(2)],
      }),

      condition: transientLoad(),
      waitBeforeRetry,
      retry,
      recordAttempt,
    });

    expect(result.status).toBe('intervention_required');

    expect(recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        maxAttempts: 2,
        outcome: 'started',
      }),
    );

    expect(recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 2,
        maxAttempts: 2,
        outcome: 'started',
      }),
    );

    expect(recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 2,
        outcome: 'exhausted',
      }),
    );
  });

  it('records retry_failed evidence when the retry returns a hard failure', async () => {
    const { waitBeforeRetry, retry, recordAttempt } = callbacks();

    retry.mockResolvedValue({
      status: 'failure',
      code: 'ACTION_FAILED',
      message: 'Retry action failed.',
    });

    await executeReplayRecovery({
      step: step({
        recovery: [retryRecovery(2)],
      }),

      condition: transientLoad(),
      waitBeforeRetry,
      retry,
      recordAttempt,
    });

    expect(recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        maxAttempts: 2,
        outcome: 'retry_failed',
      }),
    );

    const retryFailedRecord = recordAttempt.mock.calls.find(
      ([record]) => record.outcome === 'retry_failed',
    )?.[0];

    expect(retryFailedRecord).toBeDefined();

    expect(retryFailedRecord?.details.failureCode).toBe('ACTION_FAILED');

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('supplies the exact artifact-defined recovery wait policy before retry', async () => {
    const { waitBeforeRetry, retry, recordAttempt } = callbacks();

    const artifactWait = {
      timeoutMs: 8_000,
      pollIntervalMs: 250,
    };

    await executeReplayRecovery({
      step: step({
        recovery: [retryRecovery(2, artifactWait)],
      }),

      condition: transientLoad(),
      waitBeforeRetry,
      retry,
      recordAttempt,
    });

    expect(waitBeforeRetry).toHaveBeenCalledTimes(1);

    expect(waitBeforeRetry).toHaveBeenCalledWith(artifactWait, 1);
  });

  it('uses a deterministic bounded runtime default when retry metadata omits wait', async () => {
    const { waitBeforeRetry, retry, recordAttempt } = callbacks();

    await executeReplayRecovery({
      step: step({
        recovery: [retryRecovery(2)],
      }),

      condition: transientLoad(),
      waitBeforeRetry,
      retry,
      recordAttempt,
    });

    expect(waitBeforeRetry).toHaveBeenCalledWith(
      {
        timeoutMs: 5_000,
        pollIntervalMs: 100,
      },
      1,
    );
  });

  it('executes exactly one deterministic recovery attempt for KNOWN_INTERSTITIAL', async () => {
    const { waitBeforeRetry, retry, recordAttempt } = callbacks();

    retry.mockResolvedValue({
      status: 'recovered',
    });

    const result = await executeReplayRecovery({
      step: step({
        recovery: [interstitialRecovery()],
      }),

      condition: knownInterstitial(),
      waitBeforeRetry,
      retry,
      recordAttempt,
    });

    expect(result.status).toBe('recovered');

    if (result.status === 'recovered') {
      expect(result.attempts).toBe(1);
    }

    expect(retry).toHaveBeenCalledTimes(1);

    /*
     * Interstitial recovery is a concrete deterministic
     * dismissal/re-check path, not transient-load waiting.
     */
    expect(waitBeforeRetry).not.toHaveBeenCalled();

    expect(recordAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        recoveryKind: 'dismissKnownDialog',
        attempt: 1,
        maxAttempts: 1,
        outcome: 'started',
      }),
    );
  });

  it('does not recover KNOWN_DIALOG because the current artifact schema does not authorize it', async () => {
    const { waitBeforeRetry, retry, recordAttempt } = callbacks();

    const condition = knownDialog();

    const result = await executeReplayRecovery({
      step: step({
        recovery: [retryRecovery(2), interstitialRecovery()],
      }),

      condition,
      waitBeforeRetry,
      retry,
      recordAttempt,
    });

    expect(result).toEqual({
      status: 'not_authorized',
      condition,
      reason: 'NO_MATCHING_RECOVERY_POLICY',
    });

    expect(retry).not.toHaveBeenCalled();

    expect(waitBeforeRetry).not.toHaveBeenCalled();

    expect(recordAttempt).not.toHaveBeenCalled();
  });

  it('returns not_authorized when recovery metadata does not match the detected condition', async () => {
    const { waitBeforeRetry, retry, recordAttempt } = callbacks();

    const condition = transientLoad();

    const result = await executeReplayRecovery({
      step: step({
        recovery: [interstitialRecovery()],
      }),

      condition,
      waitBeforeRetry,
      retry,
      recordAttempt,
    });

    expect(result).toEqual({
      status: 'not_authorized',
      condition,
      reason: 'NO_MATCHING_RECOVERY_POLICY',
    });

    expect(retry).not.toHaveBeenCalled();

    expect(waitBeforeRetry).not.toHaveBeenCalled();
  });

  it('delegates synchronization to the bounded wait callback instead of sleeping inside the recovery executor', async () => {
    const { waitBeforeRetry, retry, recordAttempt } = callbacks();

    retry
      .mockResolvedValueOnce({
        status: 'still_recoverable',

        condition: transientLoad({
          attempt: 1,
          maxAttempts: 2,
        }),
      })
      .mockResolvedValueOnce({
        status: 'recovered',
      });

    const result = await executeReplayRecovery({
      step: step({
        recovery: [
          retryRecovery(2, {
            timeoutMs: 6_000,
            pollIntervalMs: 200,
          }),
        ],
      }),

      condition: transientLoad(),
      waitBeforeRetry,
      retry,
      recordAttempt,
    });

    expect(result.status).toBe('recovered');

    expect(waitBeforeRetry).toHaveBeenCalledTimes(2);

    expect(retry).toHaveBeenCalledTimes(2);

    expect(waitBeforeRetry).toHaveBeenNthCalledWith(
      1,
      {
        timeoutMs: 6_000,
        pollIntervalMs: 200,
      },
      1,
    );

    expect(waitBeforeRetry).toHaveBeenNthCalledWith(
      2,
      {
        timeoutMs: 6_000,
        pollIntervalMs: 200,
      },
      2,
    );
  });
});
