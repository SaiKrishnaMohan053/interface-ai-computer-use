import { describe, expect, it } from 'vitest';

import { capabilityStepSchema } from '../../src/artifact/index.js';

describe('artifact TargetSpec persistence', () => {
  it('persists ordered semantic fallback strategies', () => {
    const step = capabilityStepSchema.parse({
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
          {
            kind: 'text',
            text: {
              value: 'Accounts',
              mode: 'exact',
              caseSensitive: false,
            },
          },
        ],
        cardinality: 'exactly-one',
      },
      risk: 'READ_ONLY',
    });

    expect(step.target?.strategies).toEqual([
      {
        kind: 'role-name',
        role: 'link',
        name: {
          value: 'Accounts',
          mode: 'exact',
          caseSensitive: false,
        },
      },
      {
        kind: 'text',
        text: {
          value: 'Accounts',
          mode: 'exact',
          caseSensitive: false,
        },
      },
    ]);
  });

  it('persists the Savings balance target structurally', () => {
    const step = capabilityStepSchema.parse({
      id: 'read-savings-balance',
      description: 'Read the current balance of the Savings account.',
      action: {
        kind: 'read',
        source: 'text',
        saveAs: {
          kind: 'outputRef',
          name: 'savingsBalance',
        },
      },
      target: {
        description: 'Savings Current Balance cell in Accounts table',
        strategies: [
          {
            kind: 'structural',
            query: {
              kind: 'table-cell',
              table: {
                name: {
                  value: 'Accounts',
                  mode: 'contains',
                  caseSensitive: false,
                },
              },
              row: {
                columnHeader: {
                  value: 'Account Type',
                  mode: 'exact',
                  caseSensitive: false,
                },
                value: {
                  value: 'Savings',
                  mode: 'exact',
                  caseSensitive: false,
                },
              },
              column: {
                header: {
                  value: 'Current Balance',
                  mode: 'exact',
                  caseSensitive: false,
                },
              },
            },
          },
        ],
        cardinality: 'exactly-one',
      },
      risk: 'READ_ONLY',
    });

    expect(step.target?.strategies[0]).toEqual({
      kind: 'structural',
      query: {
        kind: 'table-cell',
        table: {
          name: {
            value: 'Accounts',
            mode: 'contains',
            caseSensitive: false,
          },
        },
        row: {
          columnHeader: {
            value: 'Account Type',
            mode: 'exact',
            caseSensitive: false,
          },
          value: {
            value: 'Savings',
            mode: 'exact',
            caseSensitive: false,
          },
        },
        column: {
          header: {
            value: 'Current Balance',
            mode: 'exact',
            caseSensitive: false,
          },
        },
      },
    });
  });

  it('rejects runtime-resolved target handles', () => {
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

          resolutionId: 'runtime-resolution-id',
          observationId: 'runtime-observation-id',
          resolvedAt: '2026-09-17T12:00:00-05:00',
          matchedStrategyIndex: 0,
        },
        risk: 'READ_ONLY',
      }).success,
    ).toBe(false);
  });

  it('rejects DOM and browser handle snapshots', () => {
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
          elementHandle: {},
        },
        risk: 'READ_ONLY',
      }).success,
    ).toBe(false);
  });
});
