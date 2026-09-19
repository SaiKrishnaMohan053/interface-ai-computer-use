import { describe, expect, it } from 'vitest';

import { ArtifactCompiler, serializeCapabilityArtifact } from '../../src/artifact/index.js';

import {
  createCompileOptions,
  createCompilerSource,
} from '../helpers/artifact-compiler-fixture.js';

describe('ArtifactCompiler determinism', () => {
  it('produces deeply equivalent artifacts for identical source and fixed compile options', () => {
    const compiler = new ArtifactCompiler();

    const source = createCompilerSource();

    const options = createCompileOptions();

    const first = compiler.compile(source, options);

    const second = compiler.compile(source, options);

    expect(second).toEqual(first);
  });

  it('produces byte-identical serialized artifacts for identical input', () => {
    const compiler = new ArtifactCompiler();

    const source = createCompilerSource();

    const options = createCompileOptions();

    const first = compiler.compile(source, options);

    const second = compiler.compile(source, options);

    expect(serializeCapabilityArtifact(second)).toBe(serializeCapabilityArtifact(first));
  });

  it('preserves explicitly supplied compiledAt exactly across repeated compilation', () => {
    const compiler = new ArtifactCompiler();

    const options = createCompileOptions();

    const first = compiler.compile(createCompilerSource(), options);

    const second = compiler.compile(createCompilerSource(), options);

    expect(first.provenance.compiledAt).toBe('2026-09-18T16:00:00.000Z');

    expect(second.provenance.compiledAt).toBe(first.provenance.compiledAt);
  });

  it('does not introduce random capability IDs step IDs or versions', () => {
    const compiler = new ArtifactCompiler();

    const first = compiler.compile(createCompilerSource(), createCompileOptions());

    const second = compiler.compile(createCompilerSource(), createCompileOptions());

    expect(second.identity).toEqual(first.identity);

    expect(second.steps.map((step) => step.id)).toEqual(first.steps.map((step) => step.id));

    expect(second.identity.version).toBe(first.identity.version);
  });

  it('does not mutate discovery source or compile configuration', () => {
    const compiler = new ArtifactCompiler();

    const source = createCompilerSource();

    const options = createCompileOptions();

    const sourceBefore = structuredClone(source);

    const optionsBefore = structuredClone(options);

    compiler.compile(source, options);

    expect(source).toEqual(sourceBefore);

    expect(options).toEqual(optionsBefore);
  });

  it('remains deterministic when equivalent source and options are separate object instances', () => {
    const compiler = new ArtifactCompiler();

    const first = compiler.compile(createCompilerSource(), createCompileOptions());

    const second = compiler.compile(createCompilerSource(), createCompileOptions());

    expect(serializeCapabilityArtifact(second)).toBe(serializeCapabilityArtifact(first));
  });
});
