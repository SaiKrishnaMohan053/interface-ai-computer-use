import { describe, expect, it } from 'vitest';
import { conditionSpecSchema, parseConditionSpec } from '../../src/conditions/index.js';

const target = {
  description: 'Member name input',
  cardinality: 'exactly-one' as const,
  strategies: [
    {
      kind: 'css' as const,
      selector: '#member-name',
    },
  ],
};

describe('conditionSpecSchema', () => {
  it('accepts all six condition kinds', () => {
    const conditions = [
      {
        kind: 'elementVisible',
        target,
      },
      {
        kind: 'elementAbsent',
        target,
      },
      {
        kind: 'textPresent',
        text: 'Member Search',
        match: 'contains',
        caseSensitive: false,
      },
      {
        kind: 'urlMatches',
        match: {
          kind: 'pathname',
          value: '/member-search',
        },
      },
      {
        kind: 'valueEquals',
        target,
        expected: 'Alex Morgan',
      },
      {
        kind: 'loadingComplete',
      },
    ];

    expect(conditions.map((condition) => parseConditionSpec(condition).kind)).toEqual([
      'elementVisible',
      'elementAbsent',
      'textPresent',
      'urlMatches',
      'valueEquals',
      'loadingComplete',
    ]);
  });

  it('rejects unknown fields and a pathname without a leading slash', () => {
    expect(
      conditionSpecSchema.safeParse({
        kind: 'urlMatches',
        match: {
          kind: 'pathname',
          value: 'member-search',
        },
      }).success,
    ).toBe(false);

    expect(
      conditionSpecSchema.safeParse({
        kind: 'loadingComplete',
        arbitrary: true,
      }).success,
    ).toBe(false);
  });
});
