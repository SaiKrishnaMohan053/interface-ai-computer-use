import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';

import { join } from 'node:path';

import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ArtifactCompiler,
  ArtifactStore,
  serializeCapabilityArtifact,
  CAPABILITY_VERSIONING_POLICY,
  assertValidCapabilityVersion,
  compareCapabilityVersions,
  type CapabilityArtifact,
} from '../../src/artifact/index.js';

import {
  createCompileOptions,
  createCompilerSource,
} from '../helpers/artifact-compiler-fixture.js';

const createdDirectories: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'interface-ai-artifacts-'));

  createdDirectories.push(root);

  return root;
}

function compiledArtifact(): CapabilityArtifact {
  const compiler = new ArtifactCompiler();

  return compiler.compile(createCompilerSource(), createCompileOptions());
}

function withVersion(artifact: CapabilityArtifact, version: string): CapabilityArtifact {
  return {
    ...artifact,

    identity: {
      ...artifact.identity,
      version,
    },
  };
}

afterEach(async () => {
  await Promise.all(
    createdDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe('ArtifactStore', () => {
  it('saves an artifact at capability/version path', async () => {
    const rootDir = await temporaryRoot();

    const store = new ArtifactStore({
      rootDir,
    });

    const artifact = compiledArtifact();

    const savedPath = await store.save(artifact);

    expect(savedPath).toBe(join(rootDir, 'lookup_savings_balance', '1.0.0.json'));

    const persisted = await readFile(savedPath, 'utf8');

    expect(persisted).toBe(serializeCapabilityArtifact(artifact));
  });

  it('loads a saved artifact', async () => {
    const rootDir = await temporaryRoot();

    const store = new ArtifactStore({
      rootDir,
    });

    const artifact = compiledArtifact();

    await store.save(artifact);

    const loaded = await store.load('lookup_savings_balance', '1.0.0');

    expect(loaded).toEqual(artifact);
  });

  it('returns an empty version list for an unknown capability', async () => {
    const rootDir = await temporaryRoot();

    const store = new ArtifactStore({
      rootDir,
    });

    await expect(store.listVersions('missing_capability')).resolves.toEqual([]);
  });

  it('lists stored versions in semantic version order', async () => {
    const rootDir = await temporaryRoot();

    const store = new ArtifactStore({
      rootDir,
    });

    const artifact = compiledArtifact();

    for (const version of ['2.0.0', '1.10.0', '1.2.0', '1.0.0']) {
      await store.save(withVersion(artifact, version));
    }

    await expect(store.listVersions('lookup_savings_balance')).resolves.toEqual([
      '1.0.0',
      '1.2.0',
      '1.10.0',
      '2.0.0',
    ]);
  });

  it('ignores unrelated and invalid-version files when listing versions', async () => {
    const rootDir = await temporaryRoot();

    const directory = join(rootDir, 'lookup_savings_balance');

    await mkdir(directory, {
      recursive: true,
    });

    await writeFile(join(directory, 'README.txt'), 'ignore me', 'utf8');

    await writeFile(join(directory, 'latest.json'), '{}', 'utf8');

    await writeFile(join(directory, '1.0.json'), '{}', 'utf8');

    const store = new ArtifactStore({
      rootDir,
    });

    await store.save(compiledArtifact());

    await expect(store.listVersions('lookup_savings_balance')).resolves.toEqual(['1.0.0']);
  });

  it('rejects an artifact that fails semantic validation before write', async () => {
    const rootDir = await temporaryRoot();

    const store = new ArtifactStore({
      rootDir,
    });

    const artifact = compiledArtifact();

    const invalid = {
      ...artifact,

      steps: [artifact.steps[0], artifact.steps[0]],
    } as CapabilityArtifact;

    await expect(store.save(invalid)).rejects.toMatchObject({
      code: 'ARTIFACT_SEMANTIC_INVALID',
    });
  });

  it('rejects unsafe persisted content before write', async () => {
    const rootDir = await temporaryRoot();

    const store = new ArtifactStore({
      rootDir,
    });

    const artifact = compiledArtifact();

    const unsafe = {
      ...artifact,

      metadata: {
        notes: 'Authorization: Bearer secret-value',
      },
    } as CapabilityArtifact;

    await expect(store.save(unsafe)).rejects.toMatchObject({
      code: 'ARTIFACT_SENSITIVE_DATA_DETECTED',
    });
  });

  it('blocks capability ID path traversal', async () => {
    const rootDir = await temporaryRoot();

    const store = new ArtifactStore({
      rootDir,
    });

    await expect(store.load('../outside', '1.0.0')).rejects.toMatchObject({
      code: 'ARTIFACT_PATH_INVALID',
    });

    await expect(store.listVersions('../../escape')).rejects.toMatchObject({
      code: 'ARTIFACT_PATH_INVALID',
    });
  });

  it('rejects invalid capability IDs', async () => {
    const rootDir = await temporaryRoot();

    const store = new ArtifactStore({
      rootDir,
    });

    for (const capabilityId of [
      '',
      '.hidden',
      '/absolute',
      'bad/id',
      'bad\\id',
      'id with spaces',
    ]) {
      await expect(store.listVersions(capabilityId)).rejects.toMatchObject({
        code: 'ARTIFACT_PATH_INVALID',
      });
    }
  });

  it('rejects invalid storage versions with typed errors', async () => {
    const rootDir = await temporaryRoot();

    const store = new ArtifactStore({
      rootDir,
    });

    for (const version of ['', '1', '1.0', 'v1.0.0', '../1.0.0', '1.0.0/evil', ' 1.0.0 ']) {
      await expect(store.load('lookup_savings_balance', version)).rejects.toMatchObject({
        code: 'ARTIFACT_VERSION_INVALID',
      });
    }
  });

  it('does not silently overwrite the same capability version', async () => {
    const rootDir = await temporaryRoot();

    const store = new ArtifactStore({
      rootDir,
    });

    const artifact = compiledArtifact();

    const path = await store.save(artifact);

    const original = await readFile(path, 'utf8');

    await expect(store.save(artifact)).rejects.toMatchObject({
      code: 'ARTIFACT_VERSION_ALREADY_EXISTS',
    });

    const after = await readFile(path, 'utf8');

    expect(after).toBe(original);
  });

  it('returns ARTIFACT_NOT_FOUND for a missing artifact version', async () => {
    const rootDir = await temporaryRoot();

    const store = new ArtifactStore({
      rootDir,
    });

    await expect(store.load('lookup_savings_balance', '9.9.9')).rejects.toMatchObject({
      code: 'ARTIFACT_NOT_FOUND',
    });
  });

  it('rejects invalid artifacts before creating an artifact file', async () => {
    const rootDir = await temporaryRoot();

    const store = new ArtifactStore({
      rootDir,
    });

    const artifact = compiledArtifact();

    const invalid = {
      ...artifact,

      risk: {
        ...artifact.risk,
        maxStepRisk: 'READ_ONLY',
      },
    } as CapabilityArtifact;

    await expect(store.save(invalid)).rejects.toMatchObject({
      code: 'ARTIFACT_SEMANTIC_INVALID',
    });

    await expect(store.listVersions('lookup_savings_balance')).resolves.toEqual([]);
  });

  it('returns ARTIFACT_IO_ERROR for non-not-found filesystem failures', async () => {
    const rootDir = await temporaryRoot();

    const blockingFile = join(rootDir, 'blocked-root');

    await writeFile(blockingFile, 'not a directory', 'utf8');

    const store = new ArtifactStore({
      rootDir: blockingFile,
    });

    await expect(store.listVersions('lookup_savings_balance')).rejects.toMatchObject({
      code: 'ARTIFACT_IO_ERROR',
    });
  });
});

describe('capability storage version validation', () => {
  it('accepts canonical semantic versions', () => {
    expect(assertValidCapabilityVersion('1.0.0')).toBe('1.0.0');

    expect(assertValidCapabilityVersion('12.34.56')).toBe('12.34.56');
  });

  it('rejects non-canonical or invalid capability versions with a typed artifact error', () => {
    for (const version of ['', '1', '1.0', 'v1.0.0', '1.0.0-beta', '../1.0.0', ' 1.0.0 ']) {
      expect(() => assertValidCapabilityVersion(version)).toThrowError(
        expect.objectContaining({
          code: 'ARTIFACT_VERSION_INVALID',
        }),
      );
    }
  });

  it('sorts semantic versions numerically', () => {
    expect(['2.0.0', '1.10.0', '1.2.0', '1.0.0'].sort(compareCapabilityVersions)).toEqual([
      '1.0.0',
      '1.2.0',
      '1.10.0',
      '2.0.0',
    ]);
  });

  it('documents the capability SemVer contract', () => {
    expect(CAPABILITY_VERSIONING_POLICY.PATCH).toContain('no caller contract break');

    expect(CAPABILITY_VERSIONING_POLICY.MINOR).toContain('Backward-compatible');

    expect(CAPABILITY_VERSIONING_POLICY.MAJOR).toContain('Breaking');
  });
});
