import { describe, expect, it } from 'vitest';

import {
  ArtifactCompiler,
  serializeCapabilityArtifact,
  type CapabilityArtifact,
} from '../../src/artifact/index.js';

import {
  createCompileOptions,
  createCompilerSource,
} from '../helpers/artifact-compiler-fixture.js';

function compiledArtifact(): CapabilityArtifact {
  const compiler = new ArtifactCompiler();

  return compiler.compile(createCompilerSource(), createCompileOptions());
}

describe('serializeCapabilityArtifact', () => {
  it('serializes the same artifact byte-identically', () => {
    const artifact = compiledArtifact();

    const first = serializeCapabilityArtifact(artifact);

    const second = serializeCapabilityArtifact(artifact);

    expect(second).toBe(first);
  });

  it('uses stable top-level field order', () => {
    const serialized = serializeCapabilityArtifact(compiledArtifact());

    const parsed = JSON.parse(serialized) as Record<string, unknown>;

    expect(Object.keys(parsed)).toEqual([
      'schemaVersion',
      'identity',
      'compatibility',
      'inputs',
      'outputs',
      'preconditions',
      'steps',
      'knownBusinessOutcomes',
      'successCondition',
      'risk',
      'provenance',
      'metadata',
    ]);
  });

  it('uses 2-space indentation', () => {
    const serialized = serializeCapabilityArtifact(compiledArtifact());

    expect(serialized.startsWith('{\n  "schemaVersion":')).toBe(true);

    expect(serialized).toContain('\n    "id":');
  });

  it('ends with exactly one newline', () => {
    const serialized = serializeCapabilityArtifact(compiledArtifact());

    expect(serialized.endsWith('\n')).toBe(true);

    expect(serialized.endsWith('\n\n')).toBe(false);
  });

  it('round-trips to equivalent JSON data', () => {
    const artifact = compiledArtifact();

    const serialized = serializeCapabilityArtifact(artifact);

    expect(JSON.parse(serialized)).toEqual(artifact);
  });

  it('uses the explicitly supplied compiledAt without generating a runtime timestamp', () => {
    const artifact = compiledArtifact();

    expect(artifact.provenance.compiledAt).toBe('2026-09-18T16:00:00.000Z');

    const serialized = serializeCapabilityArtifact(artifact);

    expect(serialized).toContain('2026-09-18T16:00:00.000Z');

    expect(serializeCapabilityArtifact(artifact)).toBe(serialized);
  });

  it('normalizes nested object key insertion order deterministically', () => {
    const artifact = compiledArtifact();

    const reordered = {
      metadata: artifact.metadata,

      provenance: artifact.provenance,

      risk: artifact.risk,

      successCondition: artifact.successCondition,

      knownBusinessOutcomes: artifact.knownBusinessOutcomes,

      steps: artifact.steps,

      preconditions: artifact.preconditions,

      outputs: artifact.outputs,

      inputs: artifact.inputs,

      compatibility: artifact.compatibility,

      identity: artifact.identity,

      schemaVersion: artifact.schemaVersion,
    } as CapabilityArtifact;

    expect(serializeCapabilityArtifact(reordered)).toBe(serializeCapabilityArtifact(artifact));
  });
});
