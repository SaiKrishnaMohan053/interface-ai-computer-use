import type { DiscoveryRequest } from '../discovery/index.js';

import type { CapabilityInput } from './capability-artifact.js';

import { ArtifactError } from './artifact-errors.js';

type JsonValue =
  null | boolean | number | string | JsonValue[] | { readonly [key: string]: JsonValue };

export interface CompileParameterDefinition {
  readonly discoveryValue: JsonValue;
}

export type CompileParameterDefinitions = Readonly<Record<string, CompileParameterDefinition>>;

export interface ResolvedCompileParameter {
  readonly inputName: string;
  readonly discoveryValue: JsonValue;
  readonly source: 'discovery_request' | 'compile_options';
}

function parameterBindingInvalid(message: string): never {
  throw new ArtifactError('ARTIFACT_PARAMETER_BINDING_INVALID', message);
}

function jsonValuesEqual(left: JsonValue, right: JsonValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function resolveCompileParameters(
  request: DiscoveryRequest,
  inputs: readonly CapabilityInput[],
  explicit: CompileParameterDefinitions | undefined,
): readonly ResolvedCompileParameter[] {
  const resolved: ResolvedCompileParameter[] = [];

  for (const input of inputs) {
    const requestHasParameter =
      request.parameters !== undefined && hasOwn(request.parameters, input.name);

    const explicitParameter = explicit?.[input.name];

    if (requestHasParameter) {
      const requestValue = request.parameters?.[input.name];

      if (requestValue === undefined) {
        parameterBindingInvalid(`Discovery request parameter "${input.name}" has no value`);
      }

      if (
        explicitParameter !== undefined &&
        !jsonValuesEqual(requestValue, explicitParameter.discoveryValue)
      ) {
        parameterBindingInvalid(
          `Discovery request parameter "${input.name}" conflicts with compiler parameter metadata`,
        );
      }

      resolved.push({
        inputName: input.name,
        discoveryValue: requestValue,
        source: 'discovery_request',
      });

      continue;
    }

    if (explicitParameter !== undefined) {
      resolved.push({
        inputName: input.name,
        discoveryValue: explicitParameter.discoveryValue,
        source: 'compile_options',
      });

      continue;
    }

    if (input.required) {
      parameterBindingInvalid(
        `Required artifact input "${input.name}" has no discovery parameter metadata`,
      );
    }
  }

  if (explicit !== undefined) {
    for (const inputName of Object.keys(explicit)) {
      const declared = inputs.some((input) => input.name === inputName);

      if (!declared) {
        parameterBindingInvalid(
          `Compiler parameter "${inputName}" is not declared as an artifact input`,
        );
      }
    }
  }

  return resolved;
}

export interface ParameterizedInputReference {
  readonly kind: 'inputRef';
  readonly name: string;
}

export function resolveStringInputReference(
  value: string,
  parameters: readonly ResolvedCompileParameter[],
): ParameterizedInputReference {
  const matches = parameters.filter(
    (parameter) =>
      typeof parameter.discoveryValue === 'string' && parameter.discoveryValue === value,
  );

  if (matches.length === 0) {
    parameterBindingInvalid(
      'Discovery action contains an invocation-specific string with no declared parameter mapping',
    );
  }

  if (matches.length > 1) {
    parameterBindingInvalid(
      'Discovery action value matches multiple artifact inputs and cannot be parameterized safely',
    );
  }

  const match = matches[0];

  if (match === undefined) {
    parameterBindingInvalid('Unable to resolve discovery action parameter');
  }

  return {
    kind: 'inputRef',
    name: match.inputName,
  };
}
