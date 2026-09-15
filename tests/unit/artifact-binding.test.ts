import { describe, expect, it } from 'vitest';

import {
  capabilityInputBindingSchema,
  type CapabilityInputBinding,
} from '../../src/artifact/index.js';

describe('artifact input binding model', () => {
  it('uses an explicit discriminated input reference', () => {
    const binding: CapabilityInputBinding = {
      kind: 'inputRef',
      name: 'memberName',
    };

    expect(capabilityInputBindingSchema.parse(binding)).toEqual(binding);
  });

  it('is JSON serializable without template syntax', () => {
    const binding: CapabilityInputBinding = {
      kind: 'inputRef',
      name: 'memberName',
    };

    const json = JSON.stringify(binding);

    expect(json).toBe('{"kind":"inputRef","name":"memberName"}');

    expect(json).not.toContain('{{');
    expect(json).not.toContain('}}');
  });

  it('does not allow discovery-specific fallback values', () => {
    expect(
      capabilityInputBindingSchema.safeParse({
        kind: 'inputRef',
        name: 'memberName',
        fallback: 'Alex Morgan',
      }).success,
    ).toBe(false);
  });
});
