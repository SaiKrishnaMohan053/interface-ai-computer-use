import { describe, expect, it } from 'vitest';

import { knownBusinessOutcomeSchema } from '../../src/artifact/index.js';

function memberNotFoundOutcome() {
  return {
    code: 'MEMBER_NOT_FOUND',
    description: 'No member matched the supplied lookup input.',
    detector: {
      kind: 'textPresent',
      text: 'Member not found',
      match: 'contains',
      caseSensitive: false,
    },
  } as const;
}

describe('artifact known business outcomes', () => {
  it('declares MEMBER_NOT_FOUND as a capability-specific business outcome', () => {
    expect(knownBusinessOutcomeSchema.parse(memberNotFoundOutcome())).toEqual(
      memberNotFoundOutcome(),
    );
  });

  it('uses an observable detector for MEMBER_NOT_FOUND', () => {
    expect(memberNotFoundOutcome().detector).toEqual({
      kind: 'textPresent',
      text: 'Member not found',
      match: 'contains',
      caseSensitive: false,
    });
  });

  it('does not require runtime failures to become business outcomes', () => {
    const codes = [memberNotFoundOutcome()].map((outcome) => outcome.code);

    expect(codes).toContain('MEMBER_NOT_FOUND');

    expect(codes).not.toContain('PERMISSION_DENIED');
    expect(codes).not.toContain('SESSION_EXPIRED');
    expect(codes).not.toContain('APPLICATION_ERROR');
  });

  it('rejects runtime-only metadata on a business outcome', () => {
    expect(
      knownBusinessOutcomeSchema.safeParse({
        ...memberNotFoundOutcome(),
        observationId: 'runtime-observation-id',
        sessionId: 'runtime-session-id',
      }).success,
    ).toBe(false);
  });

  it('does not persist a concrete member name in the outcome', () => {
    expect(JSON.stringify(memberNotFoundOutcome())).not.toContain('Alex Morgan');
  });
});
