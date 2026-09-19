import { describe, expect, it } from 'vitest';

import {
  ArtifactCompiler,
  ArtifactError,
  assertArtifactSafeToPersist,
} from '../../src/artifact/index.js';

import {
  createCompileOptions,
  createCompilerSource,
} from '../helpers/artifact-compiler-fixture.js';

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

function expectSensitiveFailure(value: unknown): void {
  try {
    assertArtifactSafeToPersist(value);

    expect.fail('Expected artifact security scan to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(ArtifactError);

    if (error instanceof ArtifactError) {
      expect(error.code).toBe('ARTIFACT_SENSITIVE_DATA_DETECTED');
    }
  }
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

  it('accepts the genuine final compiler-produced artifact', () => {
    const compiler = new ArtifactCompiler();

    const source = createCompilerSource();

    const options = createCompileOptions();

    const artifact = compiler.compile(source, options);

    expect(() =>
      assertArtifactSafeToPersist(
        artifact,
        options.forbiddenSourceLiterals === undefined
          ? {}
          : {
              forbiddenLiterals: options.forbiddenSourceLiterals,
            },
      ),
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
        accessToken: 'secret',
      },
      {
        refreshToken: 'secret',
      },
      {
        clientSecret: 'secret',
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
      expectSensitiveFailure(unsafe);
    }
  });

  it('rejects secret-like string values under generic fields', () => {
    for (const secret of [
      'Bearer abcdefghijklmnop',

      'Basic dXNlcjpwYXNzd29yZA==',

      'sk-abcdefghijklmnopqrstuvwxyz123456',

      'ghp_abcdefghijklmnopqrstuvwxyz123456',

      'github_pat_abcdefghijklmnopqrstuvwxyz123456',

      ['xoxb', '1234567890', 'abcdefghijklmnopqrstuvwxyz'].join('-'),

      'AIzaabcdefghijklmnopqrstuvwxyz123456',

      'Cookie: session=secret',

      'Set-Cookie: session=secret',

      'password=secret-value',

      'api_key=secret-value',

      'access_token=secret-value',

      'Authorization: Bearer secret-value',
    ]) {
      expectSensitiveFailure({
        metadata: {
          notes: secret,
        },
      });
    }
  });

  it('rejects browser runtime identifiers and handles by field', () => {
    for (const unsafe of [
      {
        browserContextId: 'context-123',
      },
      {
        pageHandle: {},
      },
      {
        pageId: 'page-1',
      },
      {
        locator: {},
      },
      {
        locatorId: 'locator-1',
      },
      {
        elementHandle: {},
      },
      {
        jsHandle: {},
      },
      {
        cdpSession: {},
      },
      {
        resolvedTarget: {},
      },
      {
        runtimeHandle: {},
      },
      {
        sessionId: 'session-123',
      },
    ]) {
      expectSensitiveFailure(unsafe);
    }
  });

  it('rejects browser/runtime handle names embedded in generic strings', () => {
    for (const unsafe of [
      'BrowserContext',

      'ElementHandle',

      'JSHandle',

      'CDPSession',

      'ResolvedTarget',

      'Locator@abc123',

      'Playwright Locator instance',
    ]) {
      expectSensitiveFailure({
        metadata: {
          notes: unsafe,
        },
      });
    }
  });

  it('rejects session-specific transient identifiers', () => {
    for (const unsafe of [
      {
        sessionId: 'session-1',
      },
      {
        browserSessionId: 'browser-session-1',
      },
      {
        observationId: 'observation-4',
      },
      {
        actionId: 'action-4',
      },
      {
        dialogId: 'dialog-2',
      },
      {
        frameId: 'frame-1',
      },
      {
        runtimeId: 'runtime-1',
      },
    ]) {
      expectSensitiveFailure(unsafe);
    }
  });

  it('rejects raw DOM and HTML snapshots', () => {
    for (const unsafe of [
      {
        rawDom: '<html></html>',
      },
      {
        rawHtml: '<body></body>',
      },
      {
        htmlSnapshot: '<html></html>',
      },
      {
        notes: '<html><body><div>Member data</div></body></html>',
      },
      {
        notes: '<div data-member="123">Member data</div>',
      },
      {
        notes: '<form><input name="member"></form>',
      },
      {
        notes: '<table><tr><td>secret</td></tr></table>',
      },
    ]) {
      expectSensitiveFailure(unsafe);
    }
  });

  it('rejects raw model and provider payload fields', () => {
    for (const unsafe of [
      {
        rawOpenAIResponse: {},
      },
      {
        rawModelResponse: {},
      },
      {
        modelResponse: {},
      },
      {
        rawProviderResponse: {},
      },
      {
        providerResponse: {},
      },
      {
        rawProviderPayload: {},
      },
      {
        providerPayload: {},
      },
      {
        rawModelPayload: {},
      },
      {
        modelPayload: {},
      },
      {
        rawRequestPayload: {},
      },
      {
        rawResponsePayload: {},
      },
    ]) {
      expectSensitiveFailure(unsafe);
    }
  });

  it('rejects stringified raw provider payloads', () => {
    expectSensitiveFailure({
      metadata: {
        notes: JSON.stringify({
          id: 'response-1',
          choices: [
            {
              message: {
                content: 'response',
              },
            },
          ],
          usage: {
            input_tokens: 10,
          },
        }),
      },
    });
  });

  it('rejects rationale and chain-of-thought fields', () => {
    for (const unsafe of [
      {
        rationale: 'model reasoning',
      },
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
        cot: 'private reasoning',
      },
      {
        reasoning: 'private reasoning',
      },
      {
        reasoningTrace: 'private reasoning',
      },
      {
        modelRationale: 'raw model rationale',
      },
    ]) {
      expectSensitiveFailure(unsafe);
    }
  });

  it('rejects parameterized discovery input literals', () => {
    try {
      assertArtifactSafeToPersist(
        {
          metadata: {
            notes: 'Alex Morgan',
          },
        },
        {
          forbiddenLiterals: ['Alex Morgan'],
        },
      );

      expect.fail('Expected discovery input literal to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(ArtifactError);

      if (error instanceof ArtifactError) {
        expect(error.code).toBe('ARTIFACT_SENSITIVE_DATA_DETECTED');
      }
    }
  });

  it('rejects concrete discovery outputs', () => {
    try {
      assertArtifactSafeToPersist(
        {
          metadata: {
            notes: '$12,840.50',
          },
        },
        {
          forbiddenLiterals: ['$12,840.50'],
        },
      );

      expect.fail('Expected discovery output literal to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(ArtifactError);

      if (error instanceof ArtifactError) {
        expect(error.code).toBe('ARTIFACT_SENSITIVE_DATA_DETECTED');
      }
    }
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

  it('rejects non-serializable runtime values fail-closed', () => {
    for (const unsafe of [
      {
        metadata: {
          extra: undefined,
        },
      },

      {
        metadata: {
          extra: (): void => {},
        },
      },

      {
        metadata: {
          extra: Symbol('runtime'),
        },
      },

      {
        metadata: {
          extra: BigInt(1),
        },
      },
    ]) {
      expectSensitiveFailure(unsafe);
    }
  });
  it('compiler final gate rejects a forbidden discovery literal that survives into the candidate artifact', () => {
    const compiler = new ArtifactCompiler();

    const options = createCompileOptions();

    expect(() =>
      compiler.compile(createCompilerSource(), {
        ...options,

        sourceGoal: 'Compiled from Alex Morgan discovery.',

        forbiddenSourceLiterals: ['Alex Morgan', '$12,840.50'],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'ARTIFACT_SENSITIVE_DATA_DETECTED',
      }),
    );
  });
});
