import { describe, expect, it } from 'vitest';

import {
  CAPABILITY_ACTION_KINDS,
  capabilityActionKindSchema,
  capabilityActionSchema,
} from '../../src/artifact/index.js';

describe('artifact action vocabulary', () => {
  it('represents select using surface-neutral option semantics', () => {
    expect(
      capabilityActionSchema.safeParse({
        kind: 'select',
        option: {
          kind: 'value',
          value: {
            kind: 'inputRef',
            name: 'accountType',
          },
        },
      }).success,
    ).toBe(true);
  });
  it('defines the bounded surface-neutral action vocabulary', () => {
    expect(CAPABILITY_ACTION_KINDS).toEqual([
      'click',
      'type',
      'select',
      'check',
      'uncheck',
      'navigate',
      'read',
      'wait',
      'dismiss',
    ]);
  });

  it('accepts every supported action kind', () => {
    for (const kind of CAPABILITY_ACTION_KINDS) {
      expect(capabilityActionKindSchema.safeParse(kind).success).toBe(true);
    }
  });

  it('does not treat discovery completion as an artifact action', () => {
    expect(capabilityActionKindSchema.safeParse('complete').success).toBe(false);

    expect(
      capabilityActionSchema.safeParse({
        kind: 'complete',
        summary: 'Done',
      }).success,
    ).toBe(false);
  });

  it('does not treat escalation as an artifact action', () => {
    expect(capabilityActionKindSchema.safeParse('escalate').success).toBe(false);

    expect(
      capabilityActionSchema.safeParse({
        kind: 'escalate',
        reason: 'Need human',
      }).success,
    ).toBe(false);
  });

  it('accepts typed input actions', () => {
    expect(
      capabilityActionSchema.safeParse({
        kind: 'type',
        value: {
          kind: 'inputRef',
          name: 'memberName',
        },
        mode: 'replace',
      }).success,
    ).toBe(true);
  });

  it('accepts output-bound read actions', () => {
    expect(
      capabilityActionSchema.safeParse({
        kind: 'read',
        source: 'text',
        saveAs: {
          kind: 'outputRef',
          name: 'savingsBalance',
        },
      }).success,
    ).toBe(true);
  });

  it('accepts explicit condition waits', () => {
    expect(
      capabilityActionSchema.safeParse({
        kind: 'wait',
        condition: {
          kind: 'loadingComplete',
        },
      }).success,
    ).toBe(true);
  });

  it('rejects runtime identifiers on dismiss actions', () => {
    expect(
      capabilityActionSchema.safeParse({
        kind: 'dismiss',
        response: 'dismiss',
        dialogId: 'runtime-dialog-id',
        observationId: 'runtime-observation-id',
      }).success,
    ).toBe(false);
  });
});
