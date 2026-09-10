import { describe, expect, it } from 'vitest';

import { parseTargetSpec, targetSpecSchema } from '../../src/targeting/index.js';

const exact = (value: string) => ({
  value,
  mode: 'exact' as const,
  caseSensitive: true,
});

describe('TargetSpec', () => {
  it('accepts every strategy and preserves fallback order', () => {
    const target = parseTargetSpec({
      description: 'Savings balance cell',
      cardinality: 'exactly-one',

      strategies: [
        {
          kind: 'role-name',
          role: 'cell',
          name: exact('$12,840.50'),
        },
        {
          kind: 'label',
          label: exact('Current Balance'),
        },
        {
          kind: 'text',
          text: exact('$12,840.50'),
        },
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
        {
          kind: 'css',
          selector: 'table tbody tr td:last-child',
        },
        {
          kind: 'xpath',
          expression: '//tr[td[normalize-space()="Savings"]]/td[last()]',
        },
      ],
    });

    expect(target.strategies.map((strategy) => strategy.kind)).toEqual([
      'role-name',
      'label',
      'text',
      'structural',
      'css',
      'xpath',
    ]);
  });

  it('supports a structural target within a named container', () => {
    expect(
      targetSpecSchema.safeParse({
        description: 'Continue link in service notice',

        cardinality: 'exactly-one',

        strategies: [
          {
            kind: 'structural',

            query: {
              kind: 'within',

              container: {
                role: 'dialog',

                name: exact('Scheduled Service Notice'),
              },

              target: {
                role: 'link',
                name: exact('Continue'),
              },
            },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('requires explicit exactly-one cardinality', () => {
    const missing = {
      description: 'Search button',

      strategies: [
        {
          kind: 'text',
          text: exact('Search'),
        },
      ],
    };

    expect(targetSpecSchema.safeParse(missing).success).toBe(false);

    expect(
      targetSpecSchema.safeParse({
        ...missing,
        cardinality: 'many',
      }).success,
    ).toBe(false);
  });

  it('rejects an empty strategy list', () => {
    expect(
      targetSpecSchema.safeParse({
        description: 'Search button',
        cardinality: 'exactly-one',
        strategies: [],
      }).success,
    ).toBe(false);
  });

  it('rejects incomplete structural anchors and descendants', () => {
    const base = {
      description: 'Control in container',
      cardinality: 'exactly-one',
    };

    expect(
      targetSpecSchema.safeParse({
        ...base,

        strategies: [
          {
            kind: 'structural',

            query: {
              kind: 'within',
              container: {},
              target: {
                role: 'button',
              },
            },
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      targetSpecSchema.safeParse({
        ...base,

        strategies: [
          {
            kind: 'structural',

            query: {
              kind: 'within',

              container: {
                role: 'dialog',
              },

              target: {
                zeroBasedIndex: 0,
              },
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects blank values, unknown fields and invalid indexes', () => {
    const base = {
      description: 'Target',
      cardinality: 'exactly-one',
    };

    expect(
      targetSpecSchema.safeParse({
        ...base,

        strategies: [
          {
            kind: 'css',
            selector: '   ',
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      targetSpecSchema.safeParse({
        ...base,
        unknown: true,

        strategies: [
          {
            kind: 'text',
            text: exact('Target'),
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      targetSpecSchema.safeParse({
        ...base,

        strategies: [
          {
            kind: 'structural',

            query: {
              kind: 'within',

              container: {
                role: 'form',
              },

              target: {
                role: 'textbox',
                zeroBasedIndex: -1,
              },
            },
          },
        ],
      }).success,
    ).toBe(false);
  });
});
