import { describe, expect, it } from 'vitest';

import {
  resolveReplayInputBinding,
  resolveReplayStringInputBinding,
} from '../../src/replay/index.js';

import type { CapabilityArtifact } from '../../src/artifact/index.js';

const artifact: Pick<CapabilityArtifact, 'inputs'> = {
  inputs: [
    {
      name: 'memberName',
      type: 'string',
      required: true,
      description: 'Member name.',
      sensitive: true,
    },
    {
      name: 'attemptCount',
      type: 'number',
      required: false,
      description: 'Attempt count.',
      sensitive: false,
    },
  ],
};

describe('replay input binding', () => {
  it('resolves inputRef from the invocation map', () => {
    const result = resolveReplayInputBinding(
      artifact,
      {
        kind: 'inputRef',
        name: 'memberName',
      },
      {
        memberName: 'Alex Morgan',
      },
    );

    expect(result).toEqual({
      status: 'resolved',
      value: 'Alex Morgan',
    });
  });

  it('resolves a string binding for future surface typing', () => {
    const result = resolveReplayStringInputBinding(
      artifact,
      {
        kind: 'inputRef',
        name: 'memberName',
      },
      {
        memberName: 'Alex Morgan',
      },
    );

    expect(result).toEqual({
      status: 'resolved',
      value: 'Alex Morgan',
    });
  });

  it('does not mutate the artifact binding', () => {
    const binding = Object.freeze({
      kind: 'inputRef' as const,
      name: 'memberName',
    });

    resolveReplayStringInputBinding(artifact, binding, {
      memberName: 'Alex Morgan',
    });

    expect(binding).toEqual({
      kind: 'inputRef',
      name: 'memberName',
    });
  });

  it('fails when an input reference is undeclared', () => {
    const result = resolveReplayInputBinding(
      artifact,
      {
        kind: 'inputRef',
        name: 'unknownInput',
      },
      {},
    );

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.code).toBe('INVALID_INPUT');
      expect(result.error.details.reason).toBe('UNDECLARED_INPUT_REFERENCE');
    }
  });

  it('fails when the bound invocation value is missing', () => {
    const result = resolveReplayInputBinding(
      artifact,
      {
        kind: 'inputRef',
        name: 'memberName',
      },
      {},
    );

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(result.error.details.reason).toBe('BOUND_INPUT_MISSING');

      expect(result.error.details.sensitive).toBe(true);
    }
  });

  it('does not leak sensitive bound values in errors', () => {
    const result = resolveReplayStringInputBinding(
      artifact,
      {
        kind: 'inputRef',
        name: 'attemptCount',
      },
      {
        attemptCount: 42,
      },
    );

    expect(result.status).toBe('failure');

    if (result.status === 'failure') {
      expect(JSON.stringify(result.error)).not.toContain('42');

      expect(result.error.details.reason).toBe('BOUND_INPUT_TYPE_MISMATCH');
    }
  });
});
