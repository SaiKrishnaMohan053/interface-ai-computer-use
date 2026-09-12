import { describe, expect, it } from 'vitest';

import {
  createDiscoveryObservationFingerprint,
  parseAgentObservation,
} from '../../src/discovery/index.js';

import type { AgentObservation } from '../../src/discovery/index.js';

function observation(): AgentObservation {
  return parseAgentObservation({
    goal: "Read Alex Morgan's Savings balance",
    step: 2,
    observationId: 'observation-2',
    capturedAt: '2026-09-12T15:00:00.000Z',

    location: {
      kind: 'web',
      url: 'https://bank.test/member/alex/accounts',
      title: 'Alex Morgan Accounts',
    },

    visibleTextSummary: 'Alex Morgan\nSavings\nCurrent Balance\n$12,840.50',

    controls: [
      {
        kind: 'button',
        role: 'button',
        accessibleName: 'View details',
        label: null,
        visibleText: 'View details',
        enabled: true,
        context: 'Savings row',
      },
    ],

    dialogs: [
      {
        kind: 'native',
        dialogId: 'volatile-dialog-id',
        type: 'alert',
        message: 'Service notice',
        defaultValue: null,
      },
    ],

    contextHints: {
      frames: ['Top-level document'],
      regions: ['Accounts table'],
    },

    loading: 'complete',

    truncated: {
      visibleText: false,
      controls: false,
    },

    extractedValues: {},
    recentAction: null,
    recentCondition: null,
    recentError: null,
  });
}

describe('discovery observation fingerprint', () => {
  it('ignores volatile run metadata and dialog IDs', () => {
    const first = observation();

    const second = parseAgentObservation({
      ...first,
      step: 9,
      observationId: 'observation-9',
      capturedAt: '2026-09-12T15:01:00.000Z',

      dialogs: [
        {
          ...first.dialogs[0],
          dialogId: 'new-dialog-id',
        },
      ],

      recentError: {
        code: 'TARGET_NOT_FOUND',
        message: 'Previous target was not found',
        recoverable: true,
      },
    });

    expect(createDiscoveryObservationFingerprint(second)).toBe(
      createDiscoveryObservationFingerprint(first),
    );
  });

  it('normalizes insignificant whitespace', () => {
    const first = observation();

    const second = parseAgentObservation({
      ...first,

      location: {
        ...first.location,
        title: '  Alex   Morgan Accounts ',
      },

      visibleTextSummary: ' Alex Morgan   Savings\n\nCurrent Balance   $12,840.50 ',

      controls: [
        {
          ...first.controls[0],
          accessibleName: ' View   details ',
          visibleText: 'View    details',
        },
      ],
    });

    expect(createDiscoveryObservationFingerprint(second)).toBe(
      createDiscoveryObservationFingerprint(first),
    );
  });

  it('changes for meaningful URL, title, text, control, or dialog changes', () => {
    const first = observation();

    const variants = [
      parseAgentObservation({
        ...first,
        location: {
          ...first.location,
          url: 'https://bank.test/member/alex/profile',
        },
      }),

      parseAgentObservation({
        ...first,
        location: {
          ...first.location,
          title: 'Alex Morgan Profile',
        },
      }),

      parseAgentObservation({
        ...first,
        visibleTextSummary: 'Different balance',
      }),

      parseAgentObservation({
        ...first,
        controls: [
          {
            ...first.controls[0],
            enabled: false,
          },
        ],
      }),

      parseAgentObservation({
        ...first,
        dialogs: [
          {
            ...first.dialogs[0],
            message: 'Different notice',
          },
        ],
      }),
    ];

    const original = createDiscoveryObservationFingerprint(first);

    for (const variant of variants) {
      expect(createDiscoveryObservationFingerprint(variant)).not.toBe(original);
    }
  });

  it('treats newly extracted data as meaningful progress', () => {
    const first = observation();

    const withOutput = parseAgentObservation({
      ...first,
      extractedValues: {
        savingsBalance: '$12,840.50',
      },
    });

    expect(createDiscoveryObservationFingerprint(withOutput)).not.toBe(
      createDiscoveryObservationFingerprint(first),
    );
  });

  it('is independent of extracted-value insertion order', () => {
    const first = parseAgentObservation({
      ...observation(),
      extractedValues: {
        savingsBalance: '$12,840.50',
        memberName: 'Alex Morgan',
      },
    });

    const second = parseAgentObservation({
      ...observation(),
      extractedValues: {
        memberName: 'Alex Morgan',
        savingsBalance: '$12,840.50',
      },
    });

    expect(createDiscoveryObservationFingerprint(second)).toBe(
      createDiscoveryObservationFingerprint(first),
    );
  });
});
