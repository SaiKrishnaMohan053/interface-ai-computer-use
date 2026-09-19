import { describe, expect, it } from 'vitest';

import {
  ArtifactCompiler,
  serializeCapabilityArtifact,
  sha256Bytes,
  sha256CapabilityArtifact,
} from '../../src/artifact/index.js';

import {
  createCompileOptions,
  createCompilerSource,
} from '../helpers/artifact-compiler-fixture.js';

describe('artifact integrity hashing', () => {
  it('produces a lowercase SHA-256 hex digest', () => {
    const digest = sha256Bytes('artifact');

    expect(digest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('hashes the deterministic serialized artifact bytes', () => {
    const artifact = new ArtifactCompiler().compile(createCompilerSource(), createCompileOptions());

    expect(sha256CapabilityArtifact(artifact)).toBe(
      sha256Bytes(serializeCapabilityArtifact(artifact)),
    );
  });

  it('returns the same hash for repeated deterministic compilation', () => {
    const first = new ArtifactCompiler().compile(createCompilerSource(), createCompileOptions());

    const second = new ArtifactCompiler().compile(createCompilerSource(), createCompileOptions());

    expect(sha256CapabilityArtifact(first)).toBe(sha256CapabilityArtifact(second));
  });

  it('changes when serialized artifact content changes', () => {
    const artifact = new ArtifactCompiler().compile(createCompilerSource(), createCompileOptions());

    const changed = {
      ...artifact,

      metadata: {
        notes: 'changed artifact bytes',
      },
    };

    expect(sha256CapabilityArtifact(changed)).not.toBe(sha256CapabilityArtifact(artifact));
  });
});
