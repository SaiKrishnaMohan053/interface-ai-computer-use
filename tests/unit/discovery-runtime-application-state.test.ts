import { describe, expect, it } from 'vitest';

import {
  detectDiscoveryApplicationState,
  parseAgentObservation,
} from '../../src/discovery/index.js';

import type { AgentObservation } from '../../src/discovery/index.js';

function observation(overrides: Record<string, unknown> = {}): AgentObservation {
  return parseAgentObservation({
    goal: "Read Alex Morgan's Savings balance",
    step: 2,

    observationId: 'observation-2',
    capturedAt: '2026-09-12T17:00:00.000Z',

    location: {
      kind: 'web',
      url: 'https://bank.test/member-search',
      title: 'Member Search | Demo Credit Union',
    },

    visibleTextSummary: 'Member Search',
    controls: [],
    dialogs: [],

    contextHints: {
      frames: [],
      regions: [],
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

    ...overrides,
  });
}

describe('discovery runtime application state', () => {
  it.each([
    ['PERMISSION_DENIED', 'permission_denied'],
    ['SESSION_EXPIRED', 'session_expired'],
    ['APPLICATION_ERROR', 'application_error'],
  ] as const)('detects %s without model interpretation', (title, expected) => {
    expect(
      detectDiscoveryApplicationState(
        observation({
          location: {
            kind: 'web',
            url: 'https://bank.test/member/alex',
            title: `${title} | Demo Credit Union`,
          },
        }),
      ),
    ).toMatchObject({ kind: expected });
  });

  it('detects an active loading state', () => {
    expect(detectDiscoveryApplicationState(observation({ loading: 'loading' }))).toEqual({
      kind: 'loading',
    });
  });

  it('recognizes only the explicit known safe demo interstitial', () => {
    const dialog = {
      kind: 'surface' as const,
      dialogId: 'service-notice',
      presentation: 'interstitial' as const,
      title: 'Scheduled Service Notice',
      text: 'This is a known demonstration notice.',
      controlNames: ['Continue'],
    };

    expect(detectDiscoveryApplicationState(observation({ dialogs: [dialog] }))).toMatchObject({
      kind: 'known_safe_dialog',
    });
  });

  it.each([
    {
      kind: 'native' as const,
      dialogId: 'native-1',
      type: 'confirm' as const,
      message: 'Approve an unknown operation?',
      defaultValue: null,
    },
    {
      kind: 'surface' as const,
      dialogId: 'surface-1',
      presentation: 'modal' as const,
      title: 'Unknown confirmation',
      text: 'Continue?',
      controlNames: ['Continue'],
    },
  ])('classifies an unknown or risky dialog as unsafe', (dialog) => {
    expect(detectDiscoveryApplicationState(observation({ dialogs: [dialog] }))).toMatchObject({
      kind: 'unsafe_dialog',
    });
  });

  it('returns ready for the normal scenario', () => {
    expect(detectDiscoveryApplicationState(observation())).toEqual({
      kind: 'ready',
    });
  });
});
