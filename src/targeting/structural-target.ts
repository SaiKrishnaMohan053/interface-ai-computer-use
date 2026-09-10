import { targetSpecSchema } from './target-spec.js';

import type { TargetSpec, TargetStrategy, TargetTextMatch } from './target-spec.js';

export interface TableCellTargetSpecInput {
  readonly description: string;

  readonly tableName: TargetTextMatch;

  readonly rowColumnHeader: TargetTextMatch;

  readonly rowValue: TargetTextMatch;

  readonly resultColumnHeader: TargetTextMatch;

  readonly fallbackStrategies?: readonly TargetStrategy[];
}

/**
 * Builds a semantic table lookup without persisting
 * row or column positions.
 *
 * Header positions are discovered from the current
 * table during resolution.
 */
export function createTableCellTargetSpec(input: TableCellTargetSpecInput): TargetSpec {
  return targetSpecSchema.parse({
    description: input.description,
    cardinality: 'exactly-one',

    strategies: [
      {
        kind: 'structural',

        query: {
          kind: 'table-cell',

          table: {
            name: input.tableName,
          },

          row: {
            columnHeader: input.rowColumnHeader,

            value: input.rowValue,
          },

          column: {
            header: input.resultColumnHeader,
          },
        },
      },

      ...(input.fallbackStrategies ?? []),
    ],
  });
}
