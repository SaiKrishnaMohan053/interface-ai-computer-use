import { describe, expect, it } from 'vitest';

import {
  DISCOVERY_DECISION_KINDS,
  discoveryDecisionSchema,
  parseDiscoveryDecision,
} from '../../src/discovery/index.js';

const exact = (value: string) => ({
  value,
  mode: 'exact' as const,
  caseSensitive: false,
});

const searchInput = {
  description: 'Member search input',

  strategies: [
    {
      kind: 'role-name' as const,
      role: 'textbox',
      name: exact('Member name'),
    },
    {
      kind: 'label' as const,
      label: exact('Member name'),
    },
  ],

  cardinality: 'exactly-one' as const,
};

const searchButton = {
  description: 'Search button',

  strategies: [
    {
      kind: 'role-name' as const,
      role: 'button',
      name: exact('Search'),
    },
  ],

  cardinality: 'exactly-one' as const,
};

const validDecisions: readonly unknown[] = [
  {
    kind: 'click',
    target: searchButton,
    reason: 'Submit the member search',
  },
  {
    kind: 'type',
    target: searchInput,
    text: 'Alex Morgan',
    mode: 'replace',
    reason: 'Enter the requested member name',
  },
  {
    kind: 'select',
    target: searchInput,
    option: {
      kind: 'label',
      label: 'Savings',
    },
    reason: 'Select the requested account type',
  },
  {
    kind: 'check',
    target: searchInput,
    reason: 'Enable the required option',
  },
  {
    kind: 'uncheck',
    target: searchInput,
    reason: 'Disable the optional setting',
  },
  {
    kind: 'navigate',
    destination: 'http://127.0.0.1:3000/member-search',
    reason: 'Open the permitted entry point',
  },
  {
    kind: 'read',

    target: {
      description: 'Savings current balance',

      strategies: [
        {
          kind: 'structural',

          query: {
            kind: 'table-cell',

            table: {
              name: exact('Accounts'),
            },

            row: {
              columnHeader: exact('Account Type'),

              value: exact('Savings'),
            },

            column: {
              header: exact('Current Balance'),
            },
          },
        },
      ],

      cardinality: 'exactly-one',
    },

    source: 'text',
    saveAs: 'savingsBalance',
    reason: 'Read the requested Savings balance',
  },
  {
    kind: 'wait',

    condition: {
      kind: 'loadingComplete',
    },

    reason: 'Wait for the current page transition to complete',
  },
  {
    kind: 'dismiss',

    dialog: {
      kind: 'surface',
      target: {
        description: 'Service notice Continue button',

        strategies: [
          {
            kind: 'role-name',
            role: 'button',
            name: exact('Continue'),
          },
        ],

        cardinality: 'exactly-one',
      },
    },

    reason: 'Dismiss the known service notice',
  },
  {
    kind: 'complete',

    summary: 'Read Alex Morgan Savings current balance.',

    outputs: {
      savingsBalance: '$12,840.50',
    },
  },
  {
    kind: 'escalate',

    reasonCode: 'AUTOMATION_STUCK',

    reason: 'No unique safe target is available',
  },
];

describe('discovery decision schema', () => {
  it('defines the complete bounded action vocabulary', () => {
    expect(DISCOVERY_DECISION_KINDS).toEqual([
      'click',
      'type',
      'select',
      'check',
      'uncheck',
      'navigate',
      'read',
      'wait',
      'dismiss',
      'complete',
      'escalate',
    ]);
  });

  it.each(validDecisions)('accepts one valid structured decision', (decision) => {
    expect(parseDiscoveryDecision(decision)).toEqual(decision);
  });

  it('accepts an explicit native-dialog response', () => {
    expect(
      parseDiscoveryDecision({
        kind: 'dismiss',

        dialog: {
          kind: 'native',
          observationId: 'observation-1',
          dialogId: 'dialog-1',

          response: {
            kind: 'dismiss',
          },
        },

        reason: 'Dismiss the observed native dialog',
      }),
    ).toMatchObject({
      kind: 'dismiss',

      dialog: {
        kind: 'native',
      },
    });
  });

  it.each(['css', 'xpath'])('rejects model-facing %s targeting', (kind) => {
    const strategy =
      kind === 'css'
        ? {
            kind,
            selector: '#member-search',
          }
        : {
            kind,
            expression: '//input[@name="member"]',
          };

    expect(
      discoveryDecisionSchema.safeParse({
        kind: 'click',

        target: {
          description: 'Unsafe model locator',

          strategies: [strategy],

          cardinality: 'exactly-one',
        },

        reason: 'Attempt a browser-specific locator',
      }).success,
    ).toBe(false);
  });

  it('rejects arbitrary JavaScript fields', () => {
    expect(
      discoveryDecisionSchema.safeParse({
        kind: 'click',
        target: searchButton,
        reason: 'Click Search',

        javascript: 'document.querySelector("button").click()',
      }).success,
    ).toBe(false);
  });

  it('rejects unsupported action kinds', () => {
    expect(
      discoveryDecisionSchema.safeParse({
        kind: 'pressKey',
        key: 'Enter',
        reason: 'Submit the search',
      }).success,
    ).toBe(false);
  });

  it('does not let the model set wait budgets', () => {
    expect(
      discoveryDecisionSchema.safeParse({
        kind: 'wait',

        condition: {
          kind: 'loadingComplete',
        },

        options: {
          timeoutMs: 1_000_000,
        },

        reason: 'Attempt to control runtime limits',
      }).success,
    ).toBe(false);
  });

  it('does not let the model manufacture policy approval', () => {
    expect(
      discoveryDecisionSchema.safeParse({
        kind: 'escalate',

        reasonCode: 'HUMAN_APPROVAL_REQUIRED',

        reason: 'Claim that human approval is required',
      }).success,
    ).toBe(false);
  });

  it('rejects read decisions without an output name', () => {
    expect(
      discoveryDecisionSchema.safeParse({
        kind: 'read',
        target: searchInput,
        source: 'value',
        reason: 'Read the field',
      }).success,
    ).toBe(false);
  });
});
