import { describe, expect, it } from 'vitest';

import {
  capabilityStepIdSchema,
  capabilityStepSchema,
  recoveryPolicySchema,
  waitPolicySchema,
} from '../../src/artifact/index.js';

describe('artifact capability steps', () => {
  it('accepts stable human-readable step IDs', () => {
    for (const id of [
      'enter-member-search',
      'submit-member-search',
      'open-accounts',
      'read-savings-balance',
    ]) {
      expect(capabilityStepIdSchema.parse(id)).toBe(id);
    }
  });

  it('rejects unstable or non-kebab-case step ID formats', () => {
    for (const id of [
      'enter_member_search',
      'Enter-Member-Search',
      'step 1',
      'STEP-1',
      '1-enter-member-search',
    ]) {
      expect(capabilityStepIdSchema.safeParse(id).success).toBe(false);
    }
  });

  it('accepts bounded condition polling metadata', () => {
    expect(
      waitPolicySchema.parse({
        timeoutMs: 5_000,
        pollIntervalMs: 100,
      }),
    ).toEqual({
      timeoutMs: 5_000,
      pollIntervalMs: 100,
    });
  });

  it('rejects invalid wait policies', () => {
    expect(
      waitPolicySchema.safeParse({
        timeoutMs: 1_000,
        pollIntervalMs: 2_000,
      }).success,
    ).toBe(false);

    expect(
      waitPolicySchema.safeParse({
        timeoutMs: 0,
        pollIntervalMs: 100,
      }).success,
    ).toBe(false);
  });

  it('supports only bounded retry recovery metadata initially', () => {
    expect(
      recoveryPolicySchema.parse({
        kind: 'retry',
        maxAttempts: 2,
        wait: {
          timeoutMs: 2_000,
          pollIntervalMs: 100,
        },
      }),
    ).toEqual({
      kind: 'retry',
      maxAttempts: 2,
      wait: {
        timeoutMs: 2_000,
        pollIntervalMs: 100,
      },
    });

    expect(
      recoveryPolicySchema.safeParse({
        kind: 'ignore-error',
      }).success,
    ).toBe(false);
  });

  it('accepts a reusable targeted capability step', () => {
    expect(
      capabilityStepSchema.safeParse({
        id: 'submit-member-search',
        description: 'Submit the member search.',
        action: {
          kind: 'click',
        },
        target: {
          description: 'Search button',
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
          cardinality: 'exactly-one',
        },
        postconditions: [
          {
            kind: 'loadingComplete',
          },
        ],
        wait: {
          timeoutMs: 5_000,
          pollIntervalMs: 100,
        },
        risk: 'REVERSIBLE',
      }).success,
    ).toBe(true);
  });

  it('rejects runtime-only fields on persisted steps', () => {
    expect(
      capabilityStepSchema.safeParse({
        id: 'open-accounts',
        description: 'Open the member Accounts view.',
        action: {
          kind: 'click',
        },
        target: {
          description: 'Accounts link',
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
        risk: 'READ_ONLY',

        actionId: 'runtime-action-id',
        observationId: 'runtime-observation-id',
      }).success,
    ).toBe(false);
  });
});
