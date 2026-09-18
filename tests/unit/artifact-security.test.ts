import { describe, expect, it } from 'vitest';

import { ArtifactError, assertArtifactSafeToPersist } from '../../src/artifact/index.js';

function safeArtifactFragment() {
  return {
    identity: {
      id: 'lookup_savings_balance',
    },
    inputs: [
      {
        name: 'memberName',
        sensitive: true,
      },
    ],
    steps: [
      {
        action: {
          kind: 'type',
          value: {
            kind: 'inputRef',
            name: 'memberName',
          },
        },
      },
      {
        action: {
          kind: 'read',
          saveAs: {
            kind: 'outputRef',
            name: 'savingsBalance',
          },
        },
      },
    ],
    provenance: {
      discoveryRunId: '9635c0c9-dc3a-4b64-aa38-b1f48a359ea0',
      sourceGoal: 'Look up a member and return their current savings balance.',
    },
  };
}

describe('artifact persistence security', () => {
  it('accepts parameterized reusable artifact data', () => {
    expect(() =>
      assertArtifactSafeToPersist(safeArtifactFragment(), {
        forbiddenLiterals: ['Alex Morgan', '$12,840.50'],
      }),
    ).not.toThrow();
  });

  it('allows the safe discovery provenance run reference', () => {
    expect(() =>
      assertArtifactSafeToPersist({
        provenance: {
          discoveryRunId: '9635c0c9-dc3a-4b64-aa38-b1f48a359ea0',
        },
      }),
    ).not.toThrow();
  });

  it('rejects secret-bearing fields', () => {
    for (const unsafe of [
      {
        apiKey: 'secret',
      },
      {
        token: 'secret',
      },
      {
        cookies: 'session=secret',
      },
      {
        password: 'secret',
      },
      {
        authorization: 'Bearer secret',
      },
      {
        authHeader: 'Bearer secret',
      },
    ]) {
      expect(() => assertArtifactSafeToPersist(unsafe)).toThrow(ArtifactError);
    }
  });

  it('rejects secret-like string values even under otherwise generic fields', () => {
    for (const secret of [
      'Bearer abcdefghijklmnop',
      'Basic dXNlcjpwYXNzd29yZA==',
      'sk-abcdefghijklmnopqrstuvwxyz123456',
      'Cookie: session=secret',
    ]) {
      expect(() =>
        assertArtifactSafeToPersist({
          metadata: {
            notes: secret,
          },
        }),
      ).toThrow(ArtifactError);
    }
  });

  it('rejects browser runtime identifiers and handles', () => {
    for (const unsafe of [
      {
        browserContextId: 'context-123',
      },
      {
        pageHandle: {},
      },
      {
        locator: {},
      },
      {
        elementHandle: {},
      },
      {
        sessionId: 'session-123',
      },
    ]) {
      expect(() => assertArtifactSafeToPersist(unsafe)).toThrow(ArtifactError);
    }
  });

  it('rejects raw DOM and HTML snapshots', () => {
    for (const unsafe of [
      {
        rawDom: '<html></html>',
      },
      {
        notes: '<html><body><div>Member data</div></body></html>',
      },
      {
        notes: '<div data-member="123">Member data</div>',
      },
    ]) {
      expect(() => assertArtifactSafeToPersist(unsafe)).toThrow(ArtifactError);
    }
  });

  it('rejects raw model responses and chain-of-thought fields', () => {
    for (const unsafe of [
      {
        rawOpenAIResponse: {},
      },
      {
        rawModelResponse: {},
      },
      {
        chainOfThought: 'private reasoning',
      },
      {
        reasoningTrace: 'private reasoning',
      },
      {
        modelRationale: 'raw model rationale',
      },
    ]) {
      expect(() => assertArtifactSafeToPersist(unsafe)).toThrow(ArtifactError);
    }
  });

  it('rejects parameterized discovery input literals', () => {
    expect(() =>
      assertArtifactSafeToPersist(
        {
          metadata: {
            notes: 'Alex Morgan',
          },
        },
        {
          forbiddenLiterals: ['Alex Morgan'],
        },
      ),
    ).toThrow(ArtifactError);
  });

  it('rejects concrete discovery outputs', () => {
    expect(() =>
      assertArtifactSafeToPersist(
        {
          metadata: {
            notes: '$12,840.50',
          },
        },
        {
          forbiddenLiterals: ['$12,840.50'],
        },
      ),
    ).toThrow(ArtifactError);
  });

  it('compares forbidden discovery literals case-insensitively', () => {
    expect(() =>
      assertArtifactSafeToPersist(
        {
          metadata: {
            notes: 'alex morgan',
          },
        },
        {
          forbiddenLiterals: ['Alex Morgan'],
        },
      ),
    ).toThrow(ArtifactError);
  });

  it('rejects discovery literals embedded inside larger strings', () => {
    expect(() =>
      assertArtifactSafeToPersist(
        {
          metadata: {
            notes: 'Compiled from the Alex Morgan discovery run.',
          },
        },
        {
          forbiddenLiterals: ['Alex Morgan'],
        },
      ),
    ).toThrow(ArtifactError);
  });
});
