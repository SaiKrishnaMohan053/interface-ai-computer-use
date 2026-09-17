import { describe, expect, it } from 'vitest';

import { conditionSpecSchema } from '../../src/conditions/index.js';
import { capabilityStepSchema } from '../../src/artifact/index.js';

describe('artifact step conditions', () => {
  it('reuses the existing ConditionSpec contract for preconditions', () => {
    const condition = {
      kind: 'elementVisible',
      target: {
        description: 'Member Name input',
        strategies: [
          {
            kind: 'role-name',
            role: 'textbox',
            name: {
              value: 'Member Name',
              mode: 'exact',
              caseSensitive: false,
            },
          },
        ],
        cardinality: 'exactly-one',
      },
    } as const;

    expect(conditionSpecSchema.safeParse(condition).success).toBe(true);

    expect(
      capabilityStepSchema.safeParse({
        id: 'enter-member-search',
        description: 'Enter the member name used for search.',
        action: {
          kind: 'type',
          value: {
            kind: 'inputRef',
            name: 'memberName',
          },
          mode: 'replace',
        },
        target: condition.target,
        preconditions: [condition],
        risk: 'REVERSIBLE',
      }).success,
    ).toBe(true);
  });

  it('expresses successful member search using existing surface conditions', () => {
    const step = capabilityStepSchema.parse({
      id: 'submit-member-search',
      description: 'Submit the member search.',
      action: {
        kind: 'click',
      },
      target: {
        description: 'Search button',
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
      },
      postconditions: [
        {
          kind: 'loadingComplete',
        },
        {
          kind: 'textPresent',
          text: 'Member Details',
          match: 'contains',
          caseSensitive: false,
        },
      ],
      wait: {
        timeoutMs: 5_000,
        pollIntervalMs: 100,
      },
      risk: 'READ_ONLY',
    });

    expect(step.postconditions).toEqual([
      {
        kind: 'loadingComplete',
      },
      {
        kind: 'textPresent',
        text: 'Member Details',
        match: 'contains',
        caseSensitive: false,
      },
    ]);
  });

  it('expresses Accounts readiness with an element-visible condition', () => {
    const condition = conditionSpecSchema.parse({
      kind: 'elementVisible',
      target: {
        description: 'Accounts table',
        strategies: [
          {
            kind: 'role-name',
            role: 'table',
            name: {
              value: 'Accounts',
              mode: 'contains',
              caseSensitive: false,
            },
          },
        ],
        cardinality: 'exactly-one',
      },
    });

    expect(condition.kind).toBe('elementVisible');
  });

  it('does not introduce a second artifact-specific condition vocabulary', () => {
    expect(
      conditionSpecSchema.safeParse({
        kind: 'outputExtracted',
        name: 'savingsBalance',
      }).success,
    ).toBe(false);

    expect(
      conditionSpecSchema.safeParse({
        kind: 'businessOutcomeOr',
        outcomes: ['MEMBER_NOT_FOUND'],
      }).success,
    ).toBe(false);
  });
});
