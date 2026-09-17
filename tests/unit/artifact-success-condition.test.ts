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
      kind: 'all',
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

    expect(condition.kind).toBe('all');
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

  it('requires at least two conditions for all', () => {
    expect(
      artifactSuccessConditionSchema.safeParse({
        kind: 'all',
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
        kind: 'all',
        conditions: [
          {
            kind: 'all',
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

  it('does not allow nested composite condition trees', () => {
    expect(
      artifactSuccessConditionSchema.safeParse({
        kind: 'all',
        conditions: [
          {
            kind: 'any',
            conditions: [
              {
                kind: 'surface',
                condition: {
                  kind: 'loadingComplete',
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

  it('supports a bounded any composite over leaf conditions', () => {
    expect(
      artifactSuccessConditionSchema.safeParse({
        kind: 'any',
        conditions: [
          {
            kind: 'surface',
            condition: {
              kind: 'textPresent',
              text: 'Member Details',
              match: 'contains',
              caseSensitive: false,
            },
          },
          {
            kind: 'surface',
            condition: {
              kind: 'textPresent',
              text: 'Member not found',
              match: 'contains',
              caseSensitive: false,
            },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('supports negation of one leaf condition', () => {
    expect(
      artifactSuccessConditionSchema.safeParse({
        kind: 'not',
        condition: {
          kind: 'surface',
          condition: {
            kind: 'textPresent',
            text: 'Application Error',
            match: 'contains',
            caseSensitive: false,
          },
        },
      }).success,
    ).toBe(true);
  });

  it('requires at least two leaf conditions for any', () => {
    expect(
      artifactSuccessConditionSchema.safeParse({
        kind: 'any',
        conditions: [
          {
            kind: 'surface',
            condition: {
              kind: 'loadingComplete',
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects composite conditions inside not', () => {
    expect(
      artifactSuccessConditionSchema.safeParse({
        kind: 'not',
        condition: {
          kind: 'all',
          conditions: [
            {
              kind: 'surface',
              condition: {
                kind: 'loadingComplete',
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
        },
      }).success,
    ).toBe(false);
  });
});
