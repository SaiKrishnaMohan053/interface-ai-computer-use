import type {
  CapabilityArtifact,
  CapabilityInput,
  CapabilityValueType,
} from '../artifact/index.js';

import type { JsonValue } from '../surface/index.js';

export interface ReplayInvalidInput {
  readonly code: 'INVALID_INPUT';
  readonly message: string;
  readonly expected: JsonValue;
  readonly observed: JsonValue;
  readonly details: Readonly<Record<string, JsonValue>>;
}

export type ReplayInvocationInputValidationResult =
  | {
      readonly status: 'valid';
      readonly inputs: Readonly<Record<string, JsonValue>>;
    }
  | {
      readonly status: 'invalid';
      readonly error: ReplayInvalidInput;
    };

function invalidInput(
  message: string,
  input: {
    readonly name?: string;
    readonly expected?: JsonValue;
    readonly observed?: JsonValue;
    readonly sensitive?: boolean;
    readonly reason: string;
  },
): ReplayInvocationInputValidationResult {
  return {
    status: 'invalid',
    error: {
      code: 'INVALID_INPUT',
      message,
      expected: input.expected ?? null,
      observed: input.observed ?? null,
      details: {
        reason: input.reason,

        ...(input.name === undefined
          ? {}
          : {
              inputName: input.name,
            }),

        ...(input.sensitive === undefined
          ? {}
          : {
              sensitive: input.sensitive,
            }),
      },
    },
  };
}

function observedType(value: unknown): JsonValue {
  if (value === null) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return 'array';
  }

  if (typeof value === 'number' && !Number.isFinite(value)) {
    return 'non-finite-number';
  }

  return typeof value;
}

function expectedType(type: CapabilityValueType): JsonValue {
  switch (type) {
    case 'string':
      return 'string';

    case 'number':
      return 'finite number';

    case 'boolean':
      return 'boolean';

    case 'enum':
      return 'declared enum value';

    case 'currency':
      return 'non-empty currency string or finite number';
  }
}

function validateDeclaredValue(
  declaration: CapabilityInput,
  value: unknown,
): ReplayInvocationInputValidationResult | null {
  switch (declaration.type) {
    case 'string':
      if (typeof value !== 'string') {
        return invalidInput(`Replay input "${declaration.name}" must be a string.`, {
          name: declaration.name,
          expected: expectedType(declaration.type),
          observed: observedType(value),
          sensitive: declaration.sensitive,
          reason: 'TYPE_MISMATCH',
        });
      }

      return null;

    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return invalidInput(`Replay input "${declaration.name}" must be a finite number.`, {
          name: declaration.name,
          expected: expectedType(declaration.type),
          observed: observedType(value),
          sensitive: declaration.sensitive,
          reason: 'TYPE_MISMATCH',
        });
      }

      return null;

    case 'boolean':
      if (typeof value !== 'boolean') {
        return invalidInput(`Replay input "${declaration.name}" must be a boolean.`, {
          name: declaration.name,
          expected: expectedType(declaration.type),
          observed: observedType(value),
          sensitive: declaration.sensitive,
          reason: 'TYPE_MISMATCH',
        });
      }

      return null;

    case 'currency':
      if (!(
        (typeof value === 'string' && value.trim().length > 0) ||
        (typeof value === 'number' && Number.isFinite(value))
      )) {
        return invalidInput(`Replay input "${declaration.name}" must be a currency value.`, {
          name: declaration.name,
          expected: expectedType(declaration.type),
          observed: observedType(value),
          sensitive: declaration.sensitive,
          reason: 'TYPE_MISMATCH',
        });
      }

      return null;

    case 'enum':
      /*
       * Current CapabilityInput declares only type: "enum".
       * It has no persisted allowed-values collection.
       *
       * Accepting an arbitrary string would pretend to validate enum
       * membership when the artifact contains no membership definition.
       * Fail closed until the artifact schema can express enum values.
       */
      return invalidInput(
        `Replay input "${declaration.name}" cannot be validated because the artifact does not declare enum values.`,
        {
          name: declaration.name,
          expected: expectedType(declaration.type),
          observed: observedType(value),
          sensitive: declaration.sensitive,
          reason: 'ENUM_DOMAIN_UNDECLARED',
        },
      );
  }
}

function toJsonValue(value: unknown): JsonValue | undefined {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }

  return undefined;
}

/**
 * Validates invocation inputs only against declarations from a validated
 * CapabilityArtifact.
 *
 * This function:
 * - requires all required inputs,
 * - rejects undeclared invocation inputs,
 * - validates declared primitive/value types,
 * - never emits sensitive input values in failures,
 * - returns only declared inputs,
 * - performs no browser/session activity.
 */
export function validateReplayInvocationInputs(
  artifact: CapabilityArtifact,
  suppliedInputs: Readonly<Record<string, unknown>>,
): ReplayInvocationInputValidationResult {
  const declarations = new Map(artifact.inputs.map((input) => [input.name, input] as const));

  for (const suppliedName of Object.keys(suppliedInputs)) {
    if (!declarations.has(suppliedName)) {
      return invalidInput(`Replay input "${suppliedName}" is not declared by the capability.`, {
        name: suppliedName,
        expected: 'declared capability input',
        observed: 'undeclared input',
        reason: 'UNEXPECTED_INPUT',
      });
    }
  }

  for (const declaration of artifact.inputs) {
    const supplied = Object.prototype.hasOwnProperty.call(suppliedInputs, declaration.name);

    if (!supplied) {
      if (declaration.required) {
        return invalidInput(`Required replay input "${declaration.name}" is missing.`, {
          name: declaration.name,
          expected: expectedType(declaration.type),
          observed: 'missing',
          sensitive: declaration.sensitive,
          reason: 'REQUIRED_INPUT_MISSING',
        });
      }

      continue;
    }

    const value = suppliedInputs[declaration.name];

    const typeFailure = validateDeclaredValue(declaration, value);

    if (typeFailure !== null) {
      return typeFailure;
    }
  }

  const validated: Record<string, JsonValue> = {};

  for (const declaration of artifact.inputs) {
    if (!Object.prototype.hasOwnProperty.call(suppliedInputs, declaration.name)) {
      continue;
    }

    const value = toJsonValue(suppliedInputs[declaration.name]);

    if (value === undefined) {
      return invalidInput(`Replay input "${declaration.name}" is not JSON-compatible.`, {
        name: declaration.name,
        expected: expectedType(declaration.type),
        observed: observedType(suppliedInputs[declaration.name]),
        sensitive: declaration.sensitive,
        reason: 'INVALID_JSON_VALUE',
      });
    }

    validated[declaration.name] = value;
  }

  return {
    status: 'valid',
    inputs: Object.freeze(validated),
  };
}
