import type { CapabilityArtifact, CapabilityInputBinding } from '../artifact/index.js';

import type { JsonValue } from '../surface/index.js';

export interface ReplayInputBindingError {
  readonly code: 'INVALID_INPUT';
  readonly message: string;
  readonly expected: JsonValue;
  readonly observed: JsonValue;
  readonly details: Readonly<Record<string, JsonValue>>;
}

export type ReplayInputBindingResult =
  | {
      readonly status: 'resolved';
      readonly value: JsonValue;
    }
  | {
      readonly status: 'failure';
      readonly error: ReplayInputBindingError;
    };

export type ReplayStringInputBindingResult =
  | {
      readonly status: 'resolved';
      readonly value: string;
    }
  | {
      readonly status: 'failure';
      readonly error: ReplayInputBindingError;
    };

function failure(
  message: string,
  input: {
    readonly name: string;
    readonly expected: JsonValue;
    readonly observed: JsonValue;
    readonly reason: string;
    readonly sensitive?: boolean;
  },
): ReplayInputBindingResult {
  return {
    status: 'failure',
    error: {
      code: 'INVALID_INPUT',
      message,
      expected: input.expected,
      observed: input.observed,
      details: {
        inputName: input.name,
        reason: input.reason,

        ...(input.sensitive === undefined
          ? {}
          : {
              sensitive: input.sensitive,
            }),
      },
    },
  };
}

function valueType(value: JsonValue | undefined): JsonValue {
  if (value === undefined) {
    return 'missing';
  }

  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  return typeof value;
}

/**
 * Resolves an immutable artifact inputRef against the already validated
 * invocation-input map.
 *
 * The capability artifact is read-only and is never rewritten.
 */
export function resolveReplayInputBinding(
  artifact: Pick<CapabilityArtifact, 'inputs'>,
  binding: CapabilityInputBinding,
  inputs: Readonly<Record<string, JsonValue>>,
): ReplayInputBindingResult {
  const declaration = artifact.inputs.find((input) => input.name === binding.name);

  if (declaration === undefined) {
    return failure(`Replay binding references undeclared input "${binding.name}".`, {
      name: binding.name,
      expected: 'declared capability input',
      observed: 'undeclared input reference',
      reason: 'UNDECLARED_INPUT_REFERENCE',
    });
  }

  if (!Object.prototype.hasOwnProperty.call(inputs, binding.name)) {
    return failure(`Replay binding input "${binding.name}" has no invocation value.`, {
      name: binding.name,
      expected: declaration.type,
      observed: 'missing',
      reason: 'BOUND_INPUT_MISSING',
      sensitive: declaration.sensitive,
    });
  }

  const value = inputs[binding.name];

  if (value === undefined) {
    return failure(`Replay binding input "${binding.name}" has no invocation value.`, {
      name: binding.name,
      expected: declaration.type,
      observed: 'missing',
      reason: 'BOUND_INPUT_MISSING',
      sensitive: declaration.sensitive,
    });
  }

  return {
    status: 'resolved',
    value,
  };
}

/**
 * Resolves an inputRef intended for a surface action that requires text.
 *
 * Current reusable `type` and `select` artifact actions bind string inputs,
 * while SurfaceAction requires the final concrete string.
 */
export function resolveReplayStringInputBinding(
  artifact: Pick<CapabilityArtifact, 'inputs'>,
  binding: CapabilityInputBinding,
  inputs: Readonly<Record<string, JsonValue>>,
): ReplayStringInputBindingResult {
  const resolved = resolveReplayInputBinding(artifact, binding, inputs);

  if (resolved.status === 'failure') {
    return resolved;
  }

  if (typeof resolved.value !== 'string') {
    const declaration = artifact.inputs.find((input) => input.name === binding.name);

    return {
      status: 'failure',
      error: {
        code: 'INVALID_INPUT',
        message: `Replay binding input "${binding.name}" must resolve to a string for this action.`,
        expected: 'string',
        observed: valueType(resolved.value),
        details: {
          inputName: binding.name,
          reason: 'BOUND_INPUT_TYPE_MISMATCH',

          ...(declaration === undefined
            ? {}
            : {
                sensitive: declaration.sensitive,
              }),
        },
      },
    };
  }

  return {
    status: 'resolved',
    value: resolved.value,
  };
}
