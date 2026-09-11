import { describe, expect, it } from 'vitest';

import { agentObservationSchema, parseAgentObservation } from '../../src/discovery/index.js';

const button = {
  kind: 'button' as const,
  role: 'button',
  accessibleName: 'Search',
  label: null,
  visibleText: 'Search',
  enabled: true,
  context: 'Member Search form',
};

const validObservation = {
  goal: "Find Alex Morgan's Savings account balance",
  step: 3,
  observationId: 'observation-3',
  capturedAt: '2026-09-11T14:30:00.000Z',

  location: {
    kind: 'web' as const,
    url: 'https://example.test/accounts',
    title: 'Account Search',
  },

  visibleTextSummary: 'Alex Morgan. Savings account. Current balance: $12,840.50.',

  controls: [button],
  dialogs: [],

  contextHints: {
    frames: ['Top-level document'],
    regions: ['Member Search form', 'Account results'],
  },

  loading: 'complete' as const,

  truncated: {
    visibleText: false,
    controls: false,
  },

  extractedValues: {
    savingsBalance: '$12,840.50',
  },

  recentAction: null,
  recentCondition: null,
  recentError: null,
};

describe('AgentObservation', () => {
  it('accepts a semantic web observation', () => {
    const observation = parseAgentObservation(validObservation);

    expect(observation.location.kind).toBe('web');
    expect(observation.visibleTextSummary).toContain('$12,840.50');
    expect(observation.controls[0]?.accessibleName).toBe('Search');
    expect(observation.extractedValues).toEqual({
      savingsBalance: '$12,840.50',
    });
  });

  it('supports application observations without browser objects', () => {
    const result = agentObservationSchema.safeParse({
      ...validObservation,
      location: {
        kind: 'application',
        applicationId: 'com.example.accounts',
        windowTitle: 'Accounts',
      },
      contextHints: {
        frames: [],
        regions: ['Main window'],
      },
    });

    expect(result.success).toBe(true);
  });

  it('represents dialogs, interstitials, and recent outcomes', () => {
    const result = agentObservationSchema.safeParse({
      ...validObservation,
      dialogs: [
        {
          kind: 'surface',
          dialogId: 'session-warning',
          presentation: 'interstitial',
          title: 'Session warning',
          text: 'Your session will expire soon.',
          controlNames: ['Continue session', 'Sign out'],
        },
      ],
      recentAction: {
        status: 'success',
        actionKind: 'click',
        summary: 'Opened the Savings account row.',
        output: null,
      },
      recentCondition: {
        status: 'passed',
        conditionKind: 'text_visible',
        summary: 'Savings balance is visible.',
      },
      recentError: {
        code: 'TRANSIENT_OVERLAY',
        message: 'A loading overlay briefly blocked the account row.',
        recoverable: true,
      },
    });

    expect(result.success).toBe(true);
  });

  it('supports semantic control state', () => {
    const result = agentObservationSchema.safeParse({
      ...validObservation,
      controls: [
        {
          ...button,
          kind: 'checkbox',
          accessibleName: 'Include closed accounts',
          label: 'Include closed accounts',
          visibleText: null,
          checked: true,
          indeterminate: false,
        },
        {
          ...button,
          kind: 'select',
          accessibleName: 'Account type',
          label: 'Account type',
          visibleText: null,
          multiple: false,
          options: [
            {
              label: 'Savings',
              value: 'savings',
              selected: true,
              enabled: true,
            },
            {
              label: 'Checking',
              value: 'checking',
              selected: false,
              enabled: true,
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('rejects raw browser and DOM fields', () => {
    for (const field of ['rawDom', 'page', 'browser', 'sessionId', 'cookies']) {
      const result = agentObservationSchema.safeParse({
        ...validObservation,
        [field]: {},
      });

      expect(result.success, field).toBe(false);
    }
  });

  it('rejects handles, locators, bounds, and internal control IDs', () => {
    for (const field of ['handle', 'locator', 'bounds', 'controlId']) {
      const result = agentObservationSchema.safeParse({
        ...validObservation,
        controls: [
          {
            ...button,
            [field]: {},
          },
        ],
      });

      expect(result.success, field).toBe(false);
    }
  });

  it('rejects invalid run metadata', () => {
    expect(
      agentObservationSchema.safeParse({
        ...validObservation,
        step: -1,
      }).success,
    ).toBe(false);

    expect(
      agentObservationSchema.safeParse({
        ...validObservation,
        capturedAt: 'not-a-timestamp',
      }).success,
    ).toBe(false);
  });

  it('rejects non-HTTP web locations', () => {
    const result = agentObservationSchema.safeParse({
      ...validObservation,
      location: {
        kind: 'web',
        url: 'javascript:alert(1)',
        title: 'Unsafe',
      },
    });

    expect(result.success).toBe(false);
  });
});
