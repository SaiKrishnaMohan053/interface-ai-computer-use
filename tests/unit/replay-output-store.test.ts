import { describe, expect, it } from 'vitest';

import { ReplayOutputStore } from '../../src/replay/index.js';

import type { CapabilityArtifact } from '../../src/artifact/index.js';

const artifact: Pick<CapabilityArtifact, 'outputs'> = {
  outputs: [
    {
      name: 'savingsBalance',
      type: 'currency',
      required: true,
      description: 'Savings balance.',
    },
    {
      name: 'memberActive',
      type: 'boolean',
      required: false,
      description: 'Whether member is active.',
    },
  ],
};

describe('replay output store', () => {
  it('stores a declared read output under outputRef', () => {
    const store = new ReplayOutputStore(artifact);

    const result = store.store(
      {
        kind: 'outputRef',
        name: 'savingsBalance',
      },
      '$12,840.50',
    );

    expect(result).toEqual({
      status: 'stored',
    });

    expect(store.get('savingsBalance')).toBe('$12,840.50');
  });

  it('supports finite numeric currency values', () => {
    const store = new ReplayOutputStore(artifact);

    const result = store.store(
      {
        kind: 'outputRef',
        name: 'savingsBalance',
      },
      12840.5,
    );

    expect(result.status).toBe('stored');
  });

  it('rejects undeclared output writes', () => {
    const store = new ReplayOutputStore(artifact);

    const result = store.store(
      {
        kind: 'outputRef',
        name: 'secretOutput',
      },
      'value',
    );

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('OUTPUT_EXTRACTION_FAILED');

      expect(result.error.details.reason).toBe('UNDECLARED_OUTPUT');
    }
  });

  it('rejects values that violate the declared output type', () => {
    const store = new ReplayOutputStore(artifact);

    const result = store.store(
      {
        kind: 'outputRef',
        name: 'memberActive',
      },
      'yes',
    );

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.details.reason).toBe('OUTPUT_TYPE_MISMATCH');
    }
  });

  it('fails finalization when a required output is missing', () => {
    const store = new ReplayOutputStore(artifact);

    const result = store.finalize();

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('OUTPUT_EXTRACTION_FAILED');

      expect(result.error.details.reason).toBe('REQUIRED_OUTPUT_MISSING');

      expect(result.error.details.outputName).toBe('savingsBalance');
    }
  });

  it('finalizes only declared valid outputs', () => {
    const store = new ReplayOutputStore(artifact);

    store.store(
      {
        kind: 'outputRef',
        name: 'savingsBalance',
      },
      '$12,840.50',
    );

    store.store(
      {
        kind: 'outputRef',
        name: 'memberActive',
      },
      true,
    );

    const result = store.finalize();

    expect(result).toEqual({
      status: 'valid',
      outputs: {
        savingsBalance: '$12,840.50',
        memberActive: true,
      },
    });
  });

  it('returns snapshots that cannot mutate internal storage', () => {
    const store = new ReplayOutputStore(artifact);

    store.store(
      {
        kind: 'outputRef',
        name: 'savingsBalance',
      },
      '$12,840.50',
    );

    const snapshot = store.snapshot();

    expect(snapshot).toEqual({
      savingsBalance: '$12,840.50',
    });

    expect(Object.isFrozen(snapshot)).toBe(true);
  });
});
