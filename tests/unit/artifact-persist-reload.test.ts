import { mkdtemp, readFile, rm } from 'node:fs/promises';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ArtifactCompiler,
  ArtifactStore,
  assertArtifactSafeToPersist,
  parseCapabilityArtifact,
  serializeCapabilityArtifact,
  validateCapabilityArtifactSemantics,
  type CapabilityArtifact,
} from '../../src/artifact/index.js';

import {
  createCompileOptions,
  createCompilerSource,
} from '../helpers/artifact-compiler-fixture.js';

const temporaryDirectories: string[] = [];

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'interface-ai-persist-reload-'));

  temporaryDirectories.push(root);

  return root;
}

function validateArtifact(artifact: CapabilityArtifact): CapabilityArtifact {
  const structurallyValid = parseCapabilityArtifact(artifact);

  validateCapabilityArtifactSemantics(structurallyValid);

  assertArtifactSafeToPersist(structurallyValid);

  return structurallyValid;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe('artifact persist and reload validation', () => {
  it('preserves an equivalent artifact through compile validate save load validate', async () => {
    const rootDir = await createTemporaryRoot();

    const compiler = new ArtifactCompiler();

    const compiled = compiler.compile(createCompilerSource(), createCompileOptions());

    const validatedBeforeSave = validateArtifact(compiled);

    const store = new ArtifactStore({
      rootDir,
    });

    const persistedPath = await store.save(validatedBeforeSave);

    const loaded = await store.load(compiled.identity.id, compiled.identity.version);

    const validatedAfterLoad = validateArtifact(loaded);

    expect(validatedAfterLoad).toEqual(validatedBeforeSave);

    expect(validatedAfterLoad).toEqual(compiled);

    expect(serializeCapabilityArtifact(validatedAfterLoad)).toBe(
      serializeCapabilityArtifact(validatedBeforeSave),
    );

    const persistedBytes = await readFile(persistedPath, 'utf8');

    expect(persistedBytes).toBe(serializeCapabilityArtifact(compiled));
  });

  it('preserves identity inputs outputs steps risk and provenance exactly after reload', async () => {
    const rootDir = await createTemporaryRoot();

    const compiler = new ArtifactCompiler();

    const compiled = compiler.compile(createCompilerSource(), createCompileOptions());

    const store = new ArtifactStore({
      rootDir,
    });

    await store.save(compiled);

    const loaded = await store.load(compiled.identity.id, compiled.identity.version);

    expect(loaded.identity).toEqual(compiled.identity);

    expect(loaded.inputs).toEqual(compiled.inputs);

    expect(loaded.outputs).toEqual(compiled.outputs);

    expect(loaded.steps).toEqual(compiled.steps);

    expect(loaded.risk).toEqual(compiled.risk);

    expect(loaded.provenance).toEqual(compiled.provenance);
  });

  it('preserves the four reusable compiled steps through persistence', async () => {
    const rootDir = await createTemporaryRoot();

    const compiler = new ArtifactCompiler();

    const compiled = compiler.compile(createCompilerSource(), createCompileOptions());

    const store = new ArtifactStore({
      rootDir,
    });

    await store.save(compiled);

    const loaded = await store.load('lookup_savings_balance', '1.0.0');

    expect(loaded.steps.map((step) => step.id)).toEqual([
      'enter-member-search',
      'submit-member-search',
      'open-accounts',
      'read-savings-balance',
    ]);
  });

  it('does not reintroduce concrete discovery input or output values after reload', async () => {
    const rootDir = await createTemporaryRoot();

    const compiler = new ArtifactCompiler();

    const compiled = compiler.compile(createCompilerSource(), createCompileOptions());

    const store = new ArtifactStore({
      rootDir,
    });

    await store.save(compiled);

    const loaded = await store.load(compiled.identity.id, compiled.identity.version);

    const serialized = serializeCapabilityArtifact(loaded);

    expect(serialized).not.toContain('Alex Morgan');

    expect(serialized).not.toContain('$12,840.50');
  });
});
