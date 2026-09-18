import { describe, expect, it } from 'vitest';

import { resolveCompileParameters, resolveStringInputReference } from '../../src/artifact/index.js';

describe('artifact parameterizer', () => {
  it('prefers DiscoveryRequest.parameters', () => {
    const parameters = resolveCompileParameters(
      {
        goal: 'Lookup member',
        target: {
          entryUrl: 'http://localhost/member-search',
          application: 'demo-bank',
        },
        parameters: {
          memberName: 'Alex Morgan',
        },
      },
      [
        {
          name: 'memberName',
          type: 'string',
          required: true,
          description: 'Member name used for search.',
          sensitive: true,
        },
      ],
      undefined,
    );

    expect(parameters).toEqual([
      {
        inputName: 'memberName',
        discoveryValue: 'Alex Morgan',
        source: 'discovery_request',
      },
    ]);
  });

  it('parameterizes only an explicitly declared matching value', () => {
    const reference = resolveStringInputReference('Alex Morgan', [
      {
        inputName: 'memberName',
        discoveryValue: 'Alex Morgan',
        source: 'discovery_request',
      },
    ]);

    expect(reference).toEqual({
      kind: 'inputRef',
      name: 'memberName',
    });
  });

  it('rejects an undeclared discovery value instead of guessing', () => {
    expect(() =>
      resolveStringInputReference('Unexpected UI text', [
        {
          inputName: 'memberName',
          discoveryValue: 'Alex Morgan',
          source: 'discovery_request',
        },
      ]),
    ).toThrowError(
      expect.objectContaining({
        code: 'ARTIFACT_PARAMETER_BINDING_INVALID',
      }),
    );
  });

  it('rejects ambiguous parameters with the same discovery value', () => {
    expect(() =>
      resolveStringInputReference('Alex Morgan', [
        {
          inputName: 'memberName',
          discoveryValue: 'Alex Morgan',
          source: 'discovery_request',
        },
        {
          inputName: 'authorizedBy',
          discoveryValue: 'Alex Morgan',
          source: 'compile_options',
        },
      ]),
    ).toThrowError(
      expect.objectContaining({
        code: 'ARTIFACT_PARAMETER_BINDING_INVALID',
      }),
    );
  });

  it('does not infer parameter mappings from unrelated UI text', () => {
    const parameters = resolveCompileParameters(
      {
        goal: 'Lookup member',
        target: {
          entryUrl: 'http://localhost/member-search',
          application: 'demo-bank',
        },
        parameters: {
          memberName: 'Alex Morgan',
        },
      },
      [
        {
          name: 'memberName',
          type: 'string',
          required: true,
          description: 'Member name used for search.',
          sensitive: true,
        },
      ],
      undefined,
    );

    expect(() => resolveStringInputReference('Search', parameters)).toThrowError(
      expect.objectContaining({
        code: 'ARTIFACT_PARAMETER_BINDING_INVALID',
      }),
    );
  });
});
