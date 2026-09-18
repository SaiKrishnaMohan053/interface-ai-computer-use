import { describe, expect, it } from 'vitest';

import { capabilityProvenanceSchema } from '../../src/artifact/index.js';

describe('artifact provenance', () => {
  it('stores compact discovery provenance', () => {
    expect(
      capabilityProvenanceSchema.parse({
        discoveryRunId: '9635c0c9-dc3a-4b64-aa38-b1f48a359ea0',
        compiledAt: '2026-09-18T16:00:00.000Z',
        compilerVersion: '1',
        sourceGoal: 'Look up a member and return their current savings balance.',
      }),
    ).toEqual({
      discoveryRunId: '9635c0c9-dc3a-4b64-aa38-b1f48a359ea0',
      compiledAt: '2026-09-18T16:00:00.000Z',
      compilerVersion: '1',
      sourceGoal: 'Look up a member and return their current savings balance.',
    });
  });

  it('accepts opaque discovery run references that begin with a number', () => {
    expect(
      capabilityProvenanceSchema.safeParse({
        discoveryRunId: '9635c0c9-dc3a-4b64-aa38-b1f48a359ea0',
        compiledAt: '2026-09-18T16:00:00.000Z',
        compilerVersion: '1',
        sourceGoal: 'Look up a member and return their current savings balance.',
      }).success,
    ).toBe(true);
  });

  it('requires an ISO timestamp rather than a Date instance', () => {
    expect(
      capabilityProvenanceSchema.safeParse({
        discoveryRunId: 'run-123',
        compiledAt: new Date(),
        compilerVersion: '1',
        sourceGoal: 'Look up a member and return their current savings balance.',
      }).success,
    ).toBe(false);
  });

  it('rejects an embedded discovery trace', () => {
    expect(
      capabilityProvenanceSchema.safeParse({
        discoveryRunId: 'run-123',
        compiledAt: '2026-09-18T16:00:00.000Z',
        compilerVersion: '1',
        sourceGoal: 'Look up a member and return their current savings balance.',
        trace: {
          steps: [],
        },
      }).success,
    ).toBe(false);
  });

  it('rejects raw model output and reasoning fields', () => {
    for (const forbiddenField of [
      'rawModelResponse',
      'reasoning',
      'chainOfThought',
      'modelRationale',
    ]) {
      const provenance: Record<string, unknown> = {
        discoveryRunId: 'run-123',
        compiledAt: '2026-09-18T16:00:00.000Z',
        compilerVersion: '1',
        sourceGoal: 'Look up a member and return their current savings balance.',
        [forbiddenField]: 'do not persist this',
      };

      expect(capabilityProvenanceSchema.safeParse(provenance).success).toBe(false);
    }
  });

  it('does not require trace contents to establish provenance', () => {
    const provenance = capabilityProvenanceSchema.parse({
      discoveryRunId: 'run-123',
      compiledAt: '2026-09-18T16:00:00.000Z',
      compilerVersion: '1',
      sourceGoal: 'Look up a member and return their current savings balance.',
    });

    expect(provenance).not.toHaveProperty('trace');
    expect(provenance).not.toHaveProperty('observations');
    expect(provenance).not.toHaveProperty('decisions');
  });
});
