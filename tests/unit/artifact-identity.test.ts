import { describe, expect, it } from 'vitest';

import { PRIMARY_CAPABILITY_ID, capabilityIdentitySchema } from '../../src/artifact/index.js';

describe('capability identity', () => {
  it('defines the primary reusable capability ID', () => {
    expect(PRIMARY_CAPABILITY_ID).toBe('lookup_savings_balance');
  });

  it('accepts the generalized Savings balance capability identity', () => {
    expect(
      capabilityIdentitySchema.parse({
        id: 'lookup_savings_balance',
        name: 'Lookup Savings Balance',
        version: '1.0.0',
        description:
          'Searches for a member and returns the current balance of their Savings account.',
      }),
    ).toEqual({
      id: 'lookup_savings_balance',
      name: 'Lookup Savings Balance',
      version: '1.0.0',
      description:
        'Searches for a member and returns the current balance of their Savings account.',
    });
  });

  it('rejects discovery-specific capability IDs with invalid formatting', () => {
    expect(
      capabilityIdentitySchema.safeParse({
        id: 'lookup-alex-morgan-balance',
        name: 'Lookup Alex Morgan Balance',
        version: '1.0.0',
        description: 'Looks up Alex Morgan balance.',
      }).success,
    ).toBe(false);
  });

  it('rejects IDs that are not lowercase snake_case', () => {
    for (const id of [
      'Lookup_Savings_Balance',
      'lookup-savings-balance',
      'lookup savings balance',
      'LOOKUP_SAVINGS_BALANCE',
    ]) {
      expect(
        capabilityIdentitySchema.safeParse({
          id,
          name: 'Lookup Savings Balance',
          version: '1.0.0',
          description: 'Reusable Savings balance lookup capability.',
        }).success,
      ).toBe(false);
    }
  });

  it('keeps the primary capability identity input-independent', () => {
    const identity = capabilityIdentitySchema.parse({
      id: PRIMARY_CAPABILITY_ID,
      name: 'Lookup Savings Balance',
      version: '1.0.0',
      description:
        'Searches for a member and returns the current balance of their Savings account.',
    });

    expect(identity.id).toBe('lookup_savings_balance');
    expect(identity.name).not.toContain('Alex Morgan');
    expect(identity.description).not.toContain('Alex Morgan');
  });
});
