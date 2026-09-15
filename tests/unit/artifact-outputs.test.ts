import { describe, expect, it } from 'vitest';

import {
  capabilityActionSchema,
  capabilityOutputBindingSchema,
  capabilityOutputSchema,
} from '../../src/artifact/index.js';

describe('artifact typed outputs', () => {
  it('declares savingsBalance as a required currency output', () => {
    expect(
      capabilityOutputSchema.parse({
        name: 'savingsBalance',
        type: 'currency',
        required: true,
        description: "Current balance of the member's Savings account.",
      }),
    ).toEqual({
      name: 'savingsBalance',
      type: 'currency',
      required: true,
      description: "Current balance of the member's Savings account.",
    });
  });

  it('accepts an explicit typed output reference', () => {
    expect(
      capabilityOutputBindingSchema.parse({
        kind: 'outputRef',
        name: 'savingsBalance',
      }),
    ).toEqual({
      kind: 'outputRef',
      name: 'savingsBalance',
    });
  });

  it('requires read actions to bind to a declared-output reference shape', () => {
    expect(
      capabilityActionSchema.parse({
        kind: 'read',
        saveAs: {
          kind: 'outputRef',
          name: 'savingsBalance',
        },
      }),
    ).toEqual({
      kind: 'read',
      saveAs: {
        kind: 'outputRef',
        name: 'savingsBalance',
      },
    });
  });

  it('rejects raw saveAs strings', () => {
    expect(
      capabilityActionSchema.safeParse({
        kind: 'read',
        saveAs: 'savingsBalance',
      }).success,
    ).toBe(false);
  });

  it('rejects discovery-specific output names', () => {
    expect(
      capabilityActionSchema.safeParse({
        kind: 'read',
        saveAs: 'alexMorganSavingsBalance',
      }).success,
    ).toBe(false);
  });

  it('rejects persisted discovery output values', () => {
    expect(
      capabilityActionSchema.safeParse({
        kind: 'read',
        saveAs: {
          kind: 'outputRef',
          name: 'savingsBalance',
        },
        value: '$12,840.50',
      }).success,
    ).toBe(false);
  });

  it('rejects unsupported output binding kinds', () => {
    expect(
      capabilityOutputBindingSchema.safeParse({
        kind: 'literal',
        name: 'savingsBalance',
      }).success,
    ).toBe(false);

    expect(
      capabilityOutputBindingSchema.safeParse({
        kind: 'inputRef',
        name: 'savingsBalance',
      }).success,
    ).toBe(false);
  });

  it('rejects fallback discovery values on output bindings', () => {
    expect(
      capabilityOutputBindingSchema.safeParse({
        kind: 'outputRef',
        name: 'savingsBalance',
        fallback: '$12,840.50',
      }).success,
    ).toBe(false);
  });
});
