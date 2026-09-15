import { describe, expect, it } from 'vitest';

import {
  capabilityActionSchema,
  capabilityInputReferenceSchema,
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

  it('accepts an explicit input reference', () => {
    expect(
      capabilityInputReferenceSchema.parse({
        inputRef: 'memberName',
      }),
    ).toEqual({
      inputRef: 'memberName',
    });
  });

  it('requires type actions to reference an artifact input', () => {
    expect(
      capabilityActionSchema.parse({
        kind: 'type',
        value: {
          inputRef: 'memberName',
        },
        mode: 'replace',
      }),
    ).toEqual({
      kind: 'type',
      value: {
        inputRef: 'memberName',
      },
      mode: 'replace',
    });
  });

  it('rejects a literal discovered member name as a type action value', () => {
    expect(
      capabilityActionSchema.safeParse({
        kind: 'type',
        value: 'Alex Morgan',
        mode: 'replace',
      }).success,
    ).toBe(false);
  });

  it('rejects discovery-style text fields on persisted type actions', () => {
    expect(
      capabilityActionSchema.safeParse({
        kind: 'type',
        text: 'Alex Morgan',
        mode: 'replace',
      }).success,
    ).toBe(false);
  });

  it('rejects undeclared extra fields on input references', () => {
    expect(
      capabilityInputReferenceSchema.safeParse({
        inputRef: 'memberName',
        fallback: 'Alex Morgan',
      }).success,
    ).toBe(false);
  });
});
