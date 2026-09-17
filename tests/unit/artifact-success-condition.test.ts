import { describe, expect, it } from 'vitest';

import { artifactSuccessConditionSchema } from '../../src/artifact/index.js';

const savingsBalanceTarget = {
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
} as const;

describe('artifact final success condition', () => {
  it('combines Savings context with required output presence', () => {
    const condition = artifactSuccessConditionSchema.parse({
      kind: 'allOf',
      conditions: [
        {
          kind: 'surface',
          condition: {
            kind: 'elementVisible',
            target: savingsBalanceTarget,
          },
        },
        {
          kind: 'outputPresent',
          output: {
            kind: 'outputRef',
            name: 'savingsBalance',
          },
        },
      ],
    });

    expect(condition.kind).toBe('allOf');
  });

  it('reuses existing SurfaceCondition semantics', () => {
    expect(
      artifactSuccessConditionSchema.safeParse({
        kind: 'surface',
        condition: {
          kind: 'loadingComplete',
        },
      }).success,
    ).toBe(true);
  });

  it('supports explicit output presence', () => {
    expect(
      artifactSuccessConditionSchema.safeParse({
        kind: 'outputPresent',
        output: {
          kind: 'outputRef',
          name: 'savingsBalance',
        },
      }).success,
    ).toBe(true);
  });

  it('requires at least two conditions for allOf', () => {
    expect(
      artifactSuccessConditionSchema.safeParse({
        kind: 'allOf',
        conditions: [
          {
            kind: 'outputPresent',
            output: {
              kind: 'outputRef',
              name: 'savingsBalance',
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('does not allow discovery completion as success condition', () => {
    expect(
      artifactSuccessConditionSchema.safeParse({
        kind: 'complete',
      }).success,
    ).toBe(false);
  });

  it('does not allow arbitrary nested boolean condition trees', () => {
    expect(
      artifactSuccessConditionSchema.safeParse({
        kind: 'allOf',
        conditions: [
          {
            kind: 'allOf',
            conditions: [
              {
                kind: 'outputPresent',
                output: {
                  kind: 'outputRef',
                  name: 'savingsBalance',
                },
              },
              {
                kind: 'surface',
                condition: {
                  kind: 'loadingComplete',
                },
              },
            ],
          },
          {
            kind: 'outputPresent',
            output: {
              kind: 'outputRef',
              name: 'savingsBalance',
            },
          },
        ],
      }).success,
    ).toBe(false);
  });
});
