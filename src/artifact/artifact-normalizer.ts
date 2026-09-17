import { targetSpecSchema, type TargetSpec, type TargetStrategy } from '../targeting/index.js';

import { ArtifactError } from './artifact-errors.js';

type TargetTextMatch = Extract<TargetStrategy, { readonly kind: 'role-name' }>['name'];

type StructuralStrategy = Extract<TargetStrategy, { readonly kind: 'structural' }>;

function normalizeDescription(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeLocatorText(value: string): string {
  return value.trim();
}

function normalizeTextMatch(match: TargetTextMatch): TargetTextMatch {
  return {
    value: normalizeLocatorText(match.value),
    mode: match.mode,
    caseSensitive: match.caseSensitive,
  };
}

function normalizeStructuralQuery(query: StructuralStrategy['query']): StructuralStrategy['query'] {
  switch (query.kind) {
    case 'table-cell':
      return {
        kind: 'table-cell',
        table: {
          name: normalizeTextMatch(query.table.name),
        },
        row: {
          columnHeader: normalizeTextMatch(query.row.columnHeader),
          value: normalizeTextMatch(query.row.value),
        },
        column: {
          header: normalizeTextMatch(query.column.header),
        },
      };

    case 'within':
      return {
        kind: 'within',
        container: {
          ...(query.container.role === undefined
            ? {}
            : {
                role: normalizeLocatorText(query.container.role),
              }),
          ...(query.container.name === undefined
            ? {}
            : {
                name: normalizeTextMatch(query.container.name),
              }),
          ...(query.container.text === undefined
            ? {}
            : {
                text: normalizeTextMatch(query.container.text),
              }),
        },
        target: {
          ...(query.target.role === undefined
            ? {}
            : {
                role: normalizeLocatorText(query.target.role),
              }),
          ...(query.target.name === undefined
            ? {}
            : {
                name: normalizeTextMatch(query.target.name),
              }),
          ...(query.target.text === undefined
            ? {}
            : {
                text: normalizeTextMatch(query.target.text),
              }),
          ...(query.target.zeroBasedIndex === undefined
            ? {}
            : {
                zeroBasedIndex: query.target.zeroBasedIndex,
              }),
        },
      };
  }
}

function normalizeTargetStrategy(strategy: TargetStrategy): TargetStrategy {
  switch (strategy.kind) {
    case 'role-name':
      return {
        kind: 'role-name',
        role: normalizeLocatorText(strategy.role),
        name: normalizeTextMatch(strategy.name),
      };

    case 'label':
      return {
        kind: 'label',
        label: normalizeTextMatch(strategy.label),
      };

    case 'text':
      return {
        kind: 'text',
        text: normalizeTextMatch(strategy.text),
      };

    case 'structural':
      return {
        kind: 'structural',
        query: normalizeStructuralQuery(strategy.query),
      };

    case 'css':
      return {
        kind: 'css',
        selector: strategy.selector.trim(),
      };

    case 'xpath':
      return {
        kind: 'xpath',
        expression: strategy.expression.trim(),
      };
  }
}

function targetStrategyKey(strategy: TargetStrategy): string {
  return JSON.stringify(strategy);
}

function removeDuplicateTargetStrategies(strategies: readonly TargetStrategy[]): TargetStrategy[] {
  const seen = new Set<string>();
  const normalized: TargetStrategy[] = [];

  for (const strategy of strategies) {
    const key = targetStrategyKey(strategy);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(strategy);
  }

  return normalized;
}

/**
 * Deterministically cleans a persisted TargetSpec.
 *
 * Rules:
 * - validate the source TargetSpec;
 * - normalize only safe whitespace;
 * - preserve strategy ordering;
 * - remove exact duplicates after normalization;
 * - never invent locator strategies;
 * - never resolve a target or persist runtime handles;
 * - preserve semantic and explicitly supplied brittle fallbacks.
 */
export function normalizeArtifactTargetSpec(value: unknown): TargetSpec {
  let source: TargetSpec;

  try {
    source = targetSpecSchema.parse(value);
  } catch (error) {
    throw new ArtifactError('ARTIFACT_SOURCE_INVALID', 'Artifact target specification is invalid', {
      cause: error,
    });
  }

  const strategies = removeDuplicateTargetStrategies(
    source.strategies.map(normalizeTargetStrategy),
  );

  if (strategies.length === 0) {
    throw new ArtifactError(
      'ARTIFACT_SOURCE_INVALID',
      'Artifact target must contain at least one strategy',
    );
  }

  return targetSpecSchema.parse({
    description: normalizeDescription(source.description),
    strategies,
    cardinality: source.cardinality,
  });
}
