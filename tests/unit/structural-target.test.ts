import { describe, expect, it } from 'vitest';

import { createTableCellTargetSpec } from '../../src/targeting/index.js';

const exact = (value: string) => ({
  value,
  mode: 'exact' as const,
  caseSensitive: true,
});

describe('createTableCellTargetSpec', () => {
  it('expresses table, row-key column, row value and result column semantically', () => {
    const target = createTableCellTargetSpec({
      description: 'Savings current balance',

      tableName: exact('Accounts'),

      rowColumnHeader: exact('Account Type'),

      rowValue: exact('Savings'),

      resultColumnHeader: exact('Current Balance'),
    });

    expect(target).toEqual({
      description: 'Savings current balance',

      cardinality: 'exactly-one',

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
    });
  });
});
