import { describe, expect, it, vi } from 'vitest';

import { loadReplayArtifact, prepareReplayInvocation } from '../../src/replay/index.js';

import type { ArtifactStore, CapabilityArtifact } from '../../src/artifact/index.js';

const artifact: CapabilityArtifact = {
  schemaVersion: '1.0',

  identity: {
    id: 'lookup_savings_balance',
    name: 'Lookup Savings Balance',
    version: '1.0.0',
    description: 'Looks up a member savings balance.',
  },

  compatibility: {
    application: 'demo-bank',
    surfaceKind: 'web',
  },

  inputs: [
    {
      name: 'memberName',
      type: 'string',
      required: true,
      description: 'Member name.',
      sensitive: true,
    },
  ],

  outputs: [
    {
      name: 'savingsBalance',
      type: 'currency',
      required: true,
      description: 'Savings balance.',
    },
  ],

  steps: [
    {
      id: 'read-savings-balance',
      description: 'Read savings balance.',
      action: {
        kind: 'read',
        source: 'text',
        saveAs: {
          kind: 'outputRef',
          name: 'savingsBalance',
        },
      },
      target: {
        description: 'Savings balance',
        cardinality: 'exactly-one',
        strategies: [
          {
            kind: 'text',
            text: {
              value: 'Savings',
              mode: 'exact',
              caseSensitive: false,
            },
          },
        ],
      },
      risk: 'READ_ONLY',
    },
  ],

  successCondition: {
    kind: 'outputPresent',
    output: {
      kind: 'outputRef',
      name: 'savingsBalance',
    },
  },

  risk: {
    summaryRisk: 'READ_ONLY',
    maxStepRisk: 'READ_ONLY',
    requiresHumanByDefault: false,
    runtimePolicyRequired: true,
  },

  provenance: {
    discoveryRunId: 'discovery-run-1',
    compiledAt: '2026-09-20T12:00:00.000-05:00',
    compilerVersion: '1',
    sourceGoal: 'Lookup a member savings balance.',
  },

  metadata: {},
};

function fakeStore() {
  return {
    load: vi.fn(() => Promise.resolve(artifact)),
  } satisfies Pick<ArtifactStore, 'load'>;
}

describe('replay artifact loading', () => {
  it('loads the requested capability only through ArtifactStore.load', async () => {
    const store = fakeStore();

    const loaded = await loadReplayArtifact(store, {
      capabilityId: 'lookup_savings_balance',
      version: '1.0.0',
    });

    expect(store.load).toHaveBeenCalledOnce();

    expect(store.load).toHaveBeenCalledWith('lookup_savings_balance', '1.0.0');

    expect(loaded).toBe(artifact);
  });

  it('loads and validates invocation inputs before replay resources are needed', async () => {
    const store = fakeStore();

    const result = await prepareReplayInvocation(store, {
      capabilityId: 'lookup_savings_balance',
      version: '1.0.0',
      inputs: {
        memberName: 'Alex Morgan',
      },
    });

    expect(result.status).toBe('ready');

    if (result.status === 'ready') {
      expect(result.artifact).toBe(artifact);

      expect(result.inputs).toEqual({
        memberName: 'Alex Morgan',
      });
    }
  });

  it('returns INVALID_INPUT preparation result for invalid invocation data', async () => {
    const store = fakeStore();

    const result = await prepareReplayInvocation(store, {
      capabilityId: 'lookup_savings_balance',
      version: '1.0.0',
      inputs: {
        memberName: 123,
      },
    });

    expect(result.status).toBe('invalid_input');

    if (result.status === 'invalid_input') {
      expect(result.error.code).toBe('INVALID_INPUT');
      expect(result.error.details.inputName).toBe('memberName');
      expect(result.error.details.sensitive).toBe(true);

      expect(JSON.stringify(result.error)).not.toContain('Alex Morgan');
    }
  });
});
