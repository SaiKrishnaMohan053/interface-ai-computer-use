import { describe, expect, it } from 'vitest';

import { ArtifactError, normalizeArtifactTargetSpec } from '../../src/artifact/index.js';

describe('artifact target normalization', () => {
  it('removes duplicate strategies while preserving first-seen order', () => {
    const normalized = normalizeArtifactTargetSpec({
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
    });

    expect(normalized.strategies).toEqual([
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

  it('deduplicates strategies after safe whitespace normalization', () => {
    const normalized = normalizeArtifactTargetSpec({
      description: '  Accounts   navigation  ',
      strategies: [
        {
          kind: 'role-name',
          role: 'link',
          name: {
            value: 'Accounts ',
            mode: 'exact',
            caseSensitive: false,
          },
        },
        {
          kind: 'role-name',
          role: 'link',
          name: {
            value: ' Accounts',
            mode: 'exact',
            caseSensitive: false,
          },
        },
      ],
      cardinality: 'exactly-one',
    });

    expect(normalized.description).toBe('link named "Accounts"');

    expect(normalized.strategies).toHaveLength(1);

    expect(normalized.strategies[0]).toEqual({
      kind: 'role-name',
      role: 'link',
      name: {
        value: 'Accounts',
        mode: 'exact',
        caseSensitive: false,
      },
    });
  });

  it('does not change locator case', () => {
    const normalized = normalizeArtifactTargetSpec({
      description: 'Accounts navigation',
      strategies: [
        {
          kind: 'text',
          text: {
            value: 'Current Balance',
            mode: 'exact',
            caseSensitive: true,
          },
        },
      ],
      cardinality: 'exactly-one',
    });

    expect(normalized.strategies[0]).toEqual({
      kind: 'text',
      text: {
        value: 'Current Balance',
        mode: 'exact',
        caseSensitive: true,
      },
    });
  });

  it('preserves semantic and brittle strategies in source order', () => {
    const normalized = normalizeArtifactTargetSpec({
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
        {
          kind: 'css',
          selector: '#accounts-link',
        },
        {
          kind: 'xpath',
          expression: '//a[normalize-space()="Accounts"]',
        },
      ],
      cardinality: 'exactly-one',
    });

    expect(normalized.strategies.map((strategy) => strategy.kind)).toEqual([
      'role-name',
      'text',
      'css',
      'xpath',
    ]);
  });

  it('preserves structural Savings targeting', () => {
    const normalized = normalizeArtifactTargetSpec({
      description: ' Savings Current Balance cell ',
      strategies: [
        {
          kind: 'structural',
          query: {
            kind: 'table-cell',
            table: {
              name: {
                value: ' Accounts ',
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
                value: ' Savings ',
                mode: 'exact',
                caseSensitive: false,
              },
            },
            column: {
              header: {
                value: ' Current Balance ',
                mode: 'exact',
                caseSensitive: false,
              },
            },
          },
        },
      ],
      cardinality: 'exactly-one',
    });

    expect(normalized.strategies[0]).toEqual({
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

  it('rejects an empty strategy list', () => {
    expect(() =>
      normalizeArtifactTargetSpec({
        description: 'Accounts navigation',
        strategies: [],
        cardinality: 'exactly-one',
      }),
    ).toThrow(ArtifactError);
  });

  it('never invents additional locator strategies', () => {
    const normalized = normalizeArtifactTargetSpec({
      description: 'Accounts navigation',
      strategies: [
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
    });

    expect(normalized.strategies).toHaveLength(1);
    expect(normalized.strategies[0]?.kind).toBe('text');
  });

  it('is deterministic for identical inputs', () => {
    const input = {
      description: ' Accounts navigation ',
      strategies: [
        {
          kind: 'role-name',
          role: 'link',
          name: {
            value: ' Accounts ',
            mode: 'exact',
            caseSensitive: false,
          },
        },
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
    } as const;

    const first = normalizeArtifactTargetSpec(input);
    const second = normalizeArtifactTargetSpec(input);

    expect(second).toEqual(first);
  });

  it('derives persisted target description from semantic locator instead of discovery prose', () => {
    const normalized = normalizeArtifactTargetSpec({
      description: "the Search button on the Member Search page to look up Alex Morgan's record",

      strategies: [
        {
          kind: 'role-name',
          role: 'button',
          name: {
            value: 'Search',
            mode: 'exact',
            caseSensitive: false,
          },
        },
      ],

      cardinality: 'exactly-one',
    });

    expect(normalized.description).toBe('button named "Search"');

    expect(normalized.description).not.toContain('Alex Morgan');
  });

  it('derives a stable reviewable description for structural table targets', () => {
    const normalized = normalizeArtifactTargetSpec({
      description: 'Read savings account current balance for Alex Morgan',

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
    });

    expect(normalized.description).toBe(
      'table cell in "Accounts" where "Account Type" equals "Savings" column "Current Balance"',
    );

    expect(normalized.description).not.toContain('Alex Morgan');
  });
});
