import { describe, expect, it } from 'vitest';

import {
  capabilityActionSchema,
  capabilityInputBindingSchema,
  capabilityInputSchema,
  capabilityValueTypeSchema,
} from '../../src/artifact/index.js';

describe('artifact typed inputs', () => {
  it('supports only the initial bounded value type vocabulary', () => {
    for (const type of ['string', 'number', 'boolean', 'enum', 'currency']) {
      expect(capabilityValueTypeSchema.safeParse(type).success).toBe(true);
    }

    expect(capabilityValueTypeSchema.safeParse('date').success).toBe(false);
    expect(capabilityValueTypeSchema.safeParse('object').success).toBe(false);
    expect(capabilityValueTypeSchema.safeParse('any').success).toBe(false);
  });

  it('defines memberName as a required sensitive string input', () => {
    expect(
      capabilityInputSchema.parse({
        name: 'memberName',
        type: 'string',
        required: true,
        description: 'Member name used for search.',
        sensitive: true,
      }),
    ).toEqual({
      name: 'memberName',
      type: 'string',
      required: true,
      description: 'Member name used for search.',
      sensitive: true,
    });
  });

  it('accepts an explicit typed input binding', () => {
    expect(
      capabilityInputBindingSchema.parse({
        kind: 'inputRef',
        name: 'memberName',
      }),
    ).toEqual({
      kind: 'inputRef',
      name: 'memberName',
    });
  });

  it('requires type actions to use the typed input binding model', () => {
    expect(
      capabilityActionSchema.parse({
        kind: 'type',
        value: {
          kind: 'inputRef',
          name: 'memberName',
        },
        mode: 'replace',
      }),
    ).toEqual({
      kind: 'type',
      value: {
        kind: 'inputRef',
        name: 'memberName',
      },
      mode: 'replace',
    });
  });

  it('rejects literal discovered values', () => {
    expect(
      capabilityActionSchema.safeParse({
        kind: 'type',
        value: 'Alex Morgan',
        mode: 'replace',
      }).success,
    ).toBe(false);
  });

  it('rejects string-template bindings', () => {
    expect(
      capabilityActionSchema.safeParse({
        kind: 'type',
        value: '{{memberName}}',
        mode: 'replace',
      }).success,
    ).toBe(false);
  });

  it('rejects the previous untyped inputRef shape', () => {
    expect(
      capabilityActionSchema.safeParse({
        kind: 'type',
        value: {
          inputRef: 'memberName',
        },
        mode: 'replace',
      }).success,
    ).toBe(false);
  });

  it('rejects malformed input bindings', () => {
    expect(
      capabilityInputBindingSchema.safeParse({
        kind: 'inputRef',
      }).success,
    ).toBe(false);

    expect(
      capabilityInputBindingSchema.safeParse({
        kind: 'inputRef',
        name: 'memberName',
        fallback: 'Alex Morgan',
      }).success,
    ).toBe(false);
  });

  it('rejects unsupported binding kinds', () => {
    expect(
      capabilityInputBindingSchema.safeParse({
        kind: 'template',
        name: 'memberName',
      }).success,
    ).toBe(false);

    expect(
      capabilityInputBindingSchema.safeParse({
        kind: 'literal',
        value: 'Alex Morgan',
      }).success,
    ).toBe(false);
  });
});
