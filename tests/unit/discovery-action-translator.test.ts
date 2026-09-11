import { describe, expect, it } from 'vitest';

import {
  DiscoveryActionTranslationError,
  getDiscoveryDecisionTarget,
  translateDiscoveryDecision,
} from '../../src/discovery/index.js';

import type { AgentTargetSpec, TranslatableDiscoveryDecision } from '../../src/discovery/index.js';

import type { ResolvedTarget } from '../../src/surface/index.js';

const targetSpec: AgentTargetSpec = {
  description: 'Accounts control',
  strategies: [
    {
      kind: 'role-name',
      role: 'button',
      name: {
        value: 'Accounts',
        mode: 'exact',
        caseSensitive: false,
      },
    },
  ],
  cardinality: 'exactly-one',
};

const resolvedTarget: ResolvedTarget = {
  sessionId: 'session-1',
  surfaceId: 'surface-1',
  resolutionId: 'resolution-1',
  observationId: 'observation-1',
  resolvedAt: '2026-09-11T16:00:00.000Z',
  description: 'Accounts control',
  matchedStrategyIndex: 0,
  cardinality: 'exactly-one',
};

describe('Discovery action translation', () => {
  it.each([
    {
      decision: {
        kind: 'click',
        target: targetSpec,
        reason: 'Open accounts',
      } satisfies TranslatableDiscoveryDecision,
      expected: { kind: 'click', target: resolvedTarget },
    },
    {
      decision: {
        kind: 'type',
        target: targetSpec,
        text: 'Alex Morgan',
        mode: 'replace',
        reason: 'Search by member name',
      } satisfies TranslatableDiscoveryDecision,
      expected: {
        kind: 'type',
        target: resolvedTarget,
        text: 'Alex Morgan',
        mode: 'replace',
      },
    },
    {
      decision: {
        kind: 'select',
        target: targetSpec,
        option: { kind: 'label', label: 'Savings' },
        reason: 'Choose the account',
      } satisfies TranslatableDiscoveryDecision,
      expected: {
        kind: 'select',
        target: resolvedTarget,
        option: { kind: 'label', label: 'Savings' },
      },
    },
    {
      decision: {
        kind: 'check',
        target: targetSpec,
        reason: 'Enable the option',
      } satisfies TranslatableDiscoveryDecision,
      expected: { kind: 'check', target: resolvedTarget },
    },
    {
      decision: {
        kind: 'uncheck',
        target: targetSpec,
        reason: 'Disable the option',
      } satisfies TranslatableDiscoveryDecision,
      expected: { kind: 'uncheck', target: resolvedTarget },
    },
    {
      decision: {
        kind: 'read',
        target: targetSpec,
        source: 'text',
        saveAs: 'savingsBalance',
        reason: 'Extract the balance',
      } satisfies TranslatableDiscoveryDecision,
      expected: { kind: 'read', target: resolvedTarget, source: 'text' },
    },
  ])('injects the resolved target for $decision.kind', ({ decision, expected }) => {
    expect(
      translateDiscoveryDecision({
        decision,
        resolvedTarget,
      }),
    ).toEqual(expected);
  });

  it('translates navigation without an internal target', () => {
    expect(
      translateDiscoveryDecision({
        decision: {
          kind: 'navigate',
          destination: 'https://bank.test/member-search',
          reason: 'Open the approved entry route',
        },
        resolvedTarget: null,
      }),
    ).toEqual({
      kind: 'navigate',
      destination: 'https://bank.test/member-search',
    });
  });

  it('translates surface-dialog dismissal with an engine-resolved target', () => {
    expect(
      translateDiscoveryDecision({
        decision: {
          kind: 'dismiss',
          dialog: { kind: 'surface', target: targetSpec },
          reason: 'Continue through the known interstitial',
        },
        resolvedTarget,
      }),
    ).toEqual({
      kind: 'dismiss',
      dialog: { kind: 'surface', target: resolvedTarget },
    });
  });

  it('translates native-dialog acceptance without exposing a browser dialog handle', () => {
    const action = translateDiscoveryDecision({
      decision: {
        kind: 'dismiss',
        dialog: {
          kind: 'native',
          observationId: 'observation-1',
          dialogId: 'dialog-1',
          response: { kind: 'accept', promptText: 'confirmed' },
        },
        reason: 'Accept the known native dialog',
      },
      resolvedTarget: null,
    });

    expect(action).toEqual({
      kind: 'dismiss',
      dialog: {
        kind: 'native',
        observationId: 'observation-1',
        dialogId: 'dialog-1',
        response: { kind: 'accept', promptText: 'confirmed' },
      },
    });

    expect(action).not.toHaveProperty('dialog.handle');
  });

  it('returns only the semantic target that requires resolution', () => {
    expect(
      getDiscoveryDecisionTarget({
        kind: 'click',
        target: targetSpec,
        reason: 'Open accounts',
      }),
    ).toBe(targetSpec);

    expect(
      getDiscoveryDecisionTarget({
        kind: 'navigate',
        destination: 'https://bank.test/member-search',
        reason: 'Navigate',
      }),
    ).toBeNull();
  });

  it('rejects a target-bearing decision without a resolved target', () => {
    expect(() =>
      translateDiscoveryDecision({
        decision: {
          kind: 'click',
          target: targetSpec,
          reason: 'Open accounts',
        },
        resolvedTarget: null,
      }),
    ).toThrow(DiscoveryActionTranslationError);
  });

  it('rejects an internal target for a direct action', () => {
    expect(() =>
      translateDiscoveryDecision({
        decision: {
          kind: 'navigate',
          destination: 'https://bank.test/member-search',
          reason: 'Navigate',
        },
        resolvedTarget,
      }),
    ).toThrow('must not receive a resolved element target');
  });

  it('does not forward model-only reason or saveAs fields', () => {
    const action = translateDiscoveryDecision({
      decision: {
        kind: 'read',
        target: targetSpec,
        source: 'text',
        saveAs: 'savingsBalance',
        reason: 'Extract the visible value',
      },
      resolvedTarget,
    });

    expect(action).not.toHaveProperty('reason');
    expect(action).not.toHaveProperty('saveAs');
  });
});
