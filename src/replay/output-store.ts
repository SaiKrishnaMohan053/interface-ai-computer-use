import type {
  CapabilityArtifact,
  CapabilityOutput,
  CapabilityOutputBinding,
  CapabilityValueType,
} from '../artifact/index.js';

import type { JsonValue } from '../surface/index.js';

export interface ReplayOutputStoreError {
  readonly code: 'OUTPUT_EXTRACTION_FAILED';
  readonly message: string;
  readonly expected: JsonValue;
  readonly observed: JsonValue;
  readonly details: Readonly<Record<string, JsonValue>>;
}

export type ReplayOutputStoreResult =
  | {
      readonly status: 'stored';
    }
  | {
      readonly status: 'failure';
      readonly error: ReplayOutputStoreError;
    };

export type ReplayOutputFinalizationResult =
  | {
      readonly status: 'valid';
      readonly outputs: Readonly<Record<string, JsonValue>>;
    }
  | {
      readonly status: 'failure';
      readonly error: ReplayOutputStoreError;
    };

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
      return 'string enum value';

    case 'currency':
      return 'non-empty currency string or finite number';
  }
}

function isDeclaredOutputValueValid(output: CapabilityOutput, value: unknown): value is JsonValue {
  switch (output.type) {
    case 'string':
      return typeof value === 'string';

    case 'number':
      return typeof value === 'number' && Number.isFinite(value);

    case 'boolean':
      return typeof value === 'boolean';

    case 'enum':
      /*
       * Current artifact schema identifies enum values by type only and
       * does not persist an allowed-value domain.
       *
       * Replay can therefore validate the serialized enum shape as a
       * string but cannot invent or validate membership.
       */
      return typeof value === 'string';

    case 'currency':
      return (
        (typeof value === 'string' && value.trim().length > 0) ||
        (typeof value === 'number' && Number.isFinite(value))
      );
  }
}

function outputFailure(
  message: string,
  input: {
    readonly name: string;
    readonly expected: JsonValue;
    readonly observed: JsonValue;
    readonly reason: string;
  },
): ReplayOutputStoreError {
  return {
    code: 'OUTPUT_EXTRACTION_FAILED',
    message,
    expected: input.expected,
    observed: input.observed,
    details: {
      outputName: input.name,
      reason: input.reason,
      recoverability: 'not_recoverable',
    },
  };
}

/**
 * Run-scoped storage for declared capability outputs.
 *
 * The store is created once per replay run and never persists values back
 * into the CapabilityArtifact.
 */
export class ReplayOutputStore {
  private readonly declarations: ReadonlyMap<string, CapabilityOutput>;

  private readonly values: Record<string, JsonValue> = {};

  constructor(artifact: Pick<CapabilityArtifact, 'outputs'>) {
    this.declarations = new Map(artifact.outputs.map((output) => [output.name, output]));
  }

  store(binding: CapabilityOutputBinding, value: unknown): ReplayOutputStoreResult {
    const declaration = this.declarations.get(binding.name);

    if (declaration === undefined) {
      return {
        status: 'failure',
        error: outputFailure(`Replay attempted to store undeclared output "${binding.name}".`, {
          name: binding.name,
          expected: 'declared capability output',
          observed: 'undeclared output reference',
          reason: 'UNDECLARED_OUTPUT',
        }),
      };
    }

    if (!isDeclaredOutputValueValid(declaration, value)) {
      return {
        status: 'failure',
        error: outputFailure(
          `Replay output "${binding.name}" does not satisfy its declared type.`,
          {
            name: binding.name,
            expected: expectedType(declaration.type),
            observed: observedType(value),
            reason: 'OUTPUT_TYPE_MISMATCH',
          },
        ),
      };
    }

    this.values[binding.name] = value;

    return {
      status: 'stored',
    };
  }

  has(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.values, name);
  }

  get(name: string): JsonValue | undefined {
    return this.values[name];
  }

  snapshot(): Readonly<Record<string, JsonValue>> {
    return Object.freeze({
      ...this.values,
    });
  }

  finalize(): ReplayOutputFinalizationResult {
    for (const [name, value] of Object.entries(this.values)) {
      const declaration = this.declarations.get(name);

      if (declaration === undefined) {
        return {
          status: 'failure',
          error: outputFailure(`Replay output "${name}" is not declared by the capability.`, {
            name,
            expected: 'declared capability output',
            observed: 'undeclared stored output',
            reason: 'UNDECLARED_OUTPUT_LEAKAGE',
          }),
        };
      }

      if (!isDeclaredOutputValueValid(declaration, value)) {
        return {
          status: 'failure',
          error: outputFailure(`Replay output "${name}" does not satisfy its declared type.`, {
            name,
            expected: expectedType(declaration.type),
            observed: observedType(value),
            reason: 'OUTPUT_TYPE_MISMATCH',
          }),
        };
      }
    }

    for (const declaration of this.declarations.values()) {
      if (
        declaration.required &&
        !Object.prototype.hasOwnProperty.call(this.values, declaration.name)
      ) {
        return {
          status: 'failure',
          error: outputFailure(`Required replay output "${declaration.name}" was not produced.`, {
            name: declaration.name,
            expected: expectedType(declaration.type),
            observed: 'missing',
            reason: 'REQUIRED_OUTPUT_MISSING',
          }),
        };
      }
    }

    return {
      status: 'valid',
      outputs: this.snapshot(),
    };
  }
}
