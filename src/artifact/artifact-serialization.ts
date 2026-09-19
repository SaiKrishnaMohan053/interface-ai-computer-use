import type { CapabilityArtifact } from './capability-artifact.js';

type JsonObject = Record<string, unknown>;

function stableJsonValue(value: unknown): unknown {
  if (value === null) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((item) => stableJsonValue(item));
  }

  if (typeof value === 'object') {
    const result: JsonObject = {};

    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right, 'en'),
    );

    for (const [key, nestedValue] of entries) {
      result[key] = stableJsonValue(nestedValue);
    }

    return result;
  }

  return value;
}

/**
 * Constructs the persisted artifact in an explicit,
 * review-friendly top-level field order.
 *
 * Nested object keys are sorted deterministically.
 * Array ordering is preserved because array order is
 * semantically meaningful for steps, conditions, and
 * declared inputs/outputs.
 */
function buildStableArtifactObject(artifact: CapabilityArtifact): JsonObject {
  const result: JsonObject = {
    schemaVersion: artifact.schemaVersion,

    identity: stableJsonValue(artifact.identity),

    compatibility: stableJsonValue(artifact.compatibility),

    inputs: stableJsonValue(artifact.inputs),

    outputs: stableJsonValue(artifact.outputs),
  };

  if (artifact.preconditions !== undefined) {
    result.preconditions = stableJsonValue(artifact.preconditions);
  }

  result.steps = stableJsonValue(artifact.steps);

  if (artifact.knownBusinessOutcomes !== undefined) {
    result.knownBusinessOutcomes = stableJsonValue(artifact.knownBusinessOutcomes);
  }

  result.successCondition = stableJsonValue(artifact.successCondition);

  result.risk = stableJsonValue(artifact.risk);

  result.provenance = stableJsonValue(artifact.provenance);

  if (artifact.metadata !== undefined) {
    result.metadata = stableJsonValue(artifact.metadata);
  }

  return result;
}

/**
 * Deterministically serializes a capability artifact.
 *
 * Guarantees:
 * - stable construction order,
 * - 2-space indentation,
 * - array ordering preserved,
 * - exactly one newline at EOF,
 * - no timestamps/random values generated here.
 *
 * Any nondeterministic metadata, such as compiledAt,
 * must already have been explicitly supplied by the
 * caller/compiler.
 */
export function serializeCapabilityArtifact(artifact: CapabilityArtifact): string {
  const stable = buildStableArtifactObject(artifact);

  return `${JSON.stringify(stable, null, 2)}\n`;
}
