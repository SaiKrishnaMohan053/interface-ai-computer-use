import { describe, expect, it } from 'vitest';

import {
  capabilityStepSchema,
  RECOVERY_CONDITIONS,
  recoveryConditionSchema,
  recoveryPolicySchema,
} from '../../src/artifact/index.js';

describe('artifact recovery metadata', () => {
  it('allows recovery metadata on a capability step without defining execution', () => {
    expect(
      capabilityStepSchema.safeParse({
        id: 'open-accounts',
        description: 'Open the member Accounts view.',
        action: {
          kind: 'click',
        },
        target: {
          description: 'Accounts navigation',
          strategies: [
            {
              kind: 'role-name',
              role: 'link',
              name: {
                value: 'Accounts',
                mode: 'exact',
                caseSensitive: false,
              },
            },
          ],
          cardinality: 'exactly-one',
        },
        recovery: [
          {
            kind: 'retry',
            condition: 'TRANSIENT_LOAD',
            maxAttempts: 2,
          },
        ],
        risk: 'READ_ONLY',
      }).success,
    ).toBe(true);
  });

  it('defines only supported deterministic recovery conditions', () => {
    expect(RECOVERY_CONDITIONS).toEqual(['TRANSIENT_LOAD', 'KNOWN_INTERSTITIAL']);
  });

  it('accepts bounded retry metadata for transient loading', () => {
    expect(
      recoveryPolicySchema.parse({
        kind: 'retry',
        condition: 'TRANSIENT_LOAD',
        maxAttempts: 2,
        wait: {
          timeoutMs: 2_000,
          pollIntervalMs: 100,
        },
      }),
    ).toEqual({
      kind: 'retry',
      condition: 'TRANSIENT_LOAD',
      maxAttempts: 2,
      wait: {
        timeoutMs: 2_000,
        pollIntervalMs: 100,
      },
    });
  });

  it('accepts known interstitial dismissal metadata', () => {
    expect(
      recoveryPolicySchema.parse({
        kind: 'dismissKnownDialog',
        condition: 'KNOWN_INTERSTITIAL',
      }),
    ).toEqual({
      kind: 'dismissKnownDialog',
      condition: 'KNOWN_INTERSTITIAL',
    });
  });

  it('rejects mismatched recovery kind and condition', () => {
    expect(
      recoveryPolicySchema.safeParse({
        kind: 'retry',
        condition: 'KNOWN_INTERSTITIAL',
        maxAttempts: 2,
      }).success,
    ).toBe(false);

    expect(
      recoveryPolicySchema.safeParse({
        kind: 'dismissKnownDialog',
        condition: 'TRANSIENT_LOAD',
      }).success,
    ).toBe(false);
  });

  it('keeps retry attempts bounded', () => {
    expect(
      recoveryPolicySchema.safeParse({
        kind: 'retry',
        condition: 'TRANSIENT_LOAD',
        maxAttempts: 0,
      }).success,
    ).toBe(false);

    expect(
      recoveryPolicySchema.safeParse({
        kind: 'retry',
        condition: 'TRANSIENT_LOAD',
        maxAttempts: 4,
      }).success,
    ).toBe(false);
  });

  it('rejects speculative recovery actions', () => {
    for (const recovery of [
      {
        kind: 'refreshPage',
        condition: 'TRANSIENT_LOAD',
      },
      {
        kind: 'forceClick',
        condition: 'TRANSIENT_LOAD',
      },
      {
        kind: 'ignoreError',
        condition: 'TRANSIENT_LOAD',
      },
      {
        kind: 'runScript',
        script: 'document.querySelector("button")?.click()',
      },
    ]) {
      expect(recoveryPolicySchema.safeParse(recovery).success).toBe(false);
    }
  });

  it('rejects arbitrary recovery condition names', () => {
    expect(recoveryConditionSchema.safeParse('UNKNOWN_RECOVERY').success).toBe(false);
  });
});
