import { link, mkdir, open, readFile, readdir, stat, unlink } from 'node:fs/promises';

import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { randomUUID } from 'node:crypto';

import { ArtifactError } from './artifact-errors.js';

import { parseCapabilityArtifact } from './artifact-schema.js';

import { assertArtifactSafeToPersist } from './artifact-security.js';

import { serializeCapabilityArtifact } from './artifact-serialization.js';

import { validateCapabilityArtifactSemantics } from './artifact-validator.js';

import {
  assertValidCapabilityVersion,
  capabilityVersionSchema,
  compareCapabilityVersions,
} from './artifact-version.js';

import type { CapabilityArtifact } from './capability-artifact.js';

export interface ArtifactStoreOptions {
  readonly rootDir: string;
}

const CAPABILITY_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,199}$/;

interface NodeErrorLike extends Error {
  readonly code?: string;
}

function nodeErrorCode(error: unknown): string | undefined {
  if (error instanceof Error && 'code' in error) {
    const code = (error as NodeErrorLike).code;

    return typeof code === 'string' ? code : undefined;
  }

  return undefined;
}

function assertValidCapabilityId(capabilityId: string): string {
  if (!CAPABILITY_ID_PATTERN.test(capabilityId)) {
    throw new ArtifactError(
      'ARTIFACT_PATH_INVALID',
      `Invalid capability ID "${capabilityId}" for artifact storage.`,
      {
        capabilityId,
      },
    );
  }

  return capabilityId;
}

function assertPathWithinRoot(rootDir: string, candidatePath: string): void {
  const relativePath = relative(rootDir, candidatePath);

  if (
    relativePath === '..' ||
    relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
    isAbsolute(relativePath)
  ) {
    throw new ArtifactError(
      'ARTIFACT_PATH_INVALID',
      'Artifact path escapes the configured artifact root.',
      {
        rootDir,
        candidatePath,
      },
    );
  }
}

function ioError(operation: string, path: string, cause: unknown): ArtifactError {
  return new ArtifactError('ARTIFACT_IO_ERROR', `Artifact ${operation} failed for "${path}".`, {
    operation,
    path,
    causeCode: nodeErrorCode(cause) ?? null,
  });
}

/**
 * Filesystem-backed capability artifact store.
 *
 * Storage layout:
 *
 * <rootDir>/
 *   <capabilityId>/
 *     <version>.json
 *
 * Example:
 *
 * artifacts/
 *   lookup_savings_balance/
 *     1.0.0.json
 *
 * Persistence is fail-closed:
 *
 * schema
 * → semantic validation
 * → security validation
 * → deterministic serialization
 * → atomic publication
 */
export class ArtifactStore {
  readonly rootDir: string;

  constructor(options: ArtifactStoreOptions) {
    this.rootDir = resolve(options.rootDir);
  }

  private capabilityDirectory(capabilityId: string): string {
    const safeCapabilityId = assertValidCapabilityId(capabilityId);

    const directory = join(this.rootDir, safeCapabilityId);

    assertPathWithinRoot(this.rootDir, directory);

    return directory;
  }

  private artifactPath(capabilityId: string, version: string): string {
    const safeVersion = assertValidCapabilityVersion(version);

    const path = join(this.capabilityDirectory(capabilityId), `${safeVersion}.json`);

    assertPathWithinRoot(this.rootDir, path);

    return path;
  }

  /**
   * Publishes a completed artifact without ever
   * silently overwriting an existing version.
   *
   * The serialized bytes are first fully written
   * and fsynced to a temporary file in the same
   * directory.
   *
   * link(temp, final) atomically creates the final
   * directory entry and fails with EEXIST if the
   * version already exists.
   */
  private async atomicCreate(path: string, serialized: string): Promise<void> {
    const directory = dirname(path);

    const tempPath = join(directory, `.artifact-${process.pid}-${randomUUID()}.tmp`);

    assertPathWithinRoot(this.rootDir, tempPath);

    let tempCreated = false;

    try {
      const handle = await open(tempPath, 'wx');

      tempCreated = true;

      try {
        await handle.writeFile(serialized, {
          encoding: 'utf8',
        });

        await handle.sync();
      } finally {
        await handle.close();
      }

      try {
        await link(tempPath, path);
      } catch (error) {
        if (nodeErrorCode(error) === 'EEXIST') {
          throw new ArtifactError(
            'ARTIFACT_VERSION_ALREADY_EXISTS',
            `Artifact version already exists at "${path}".`,
            {
              path,
            },
          );
        }

        throw ioError('atomic publish', path, error);
      }
    } catch (error) {
      if (error instanceof ArtifactError) {
        throw error;
      }

      throw ioError('write', path, error);
    } finally {
      if (tempCreated) {
        try {
          await unlink(tempPath);
        } catch (error) {
          if (nodeErrorCode(error) !== 'ENOENT') {
            /*
             * Publication already succeeded or failed
             * independently. Temp cleanup must not
             * replace the primary persistence result.
             */
          }
        }
      }
    }
  }

  async save(artifact: CapabilityArtifact): Promise<string> {
    /*
     * Important: every artifact validation happens
     * before mkdir/write. Invalid artifacts therefore
     * cannot create persisted artifact files.
     */
    const parsed = parseCapabilityArtifact(artifact);

    validateCapabilityArtifactSemantics(parsed);

    assertArtifactSafeToPersist(parsed);

    const capabilityId = assertValidCapabilityId(parsed.identity.id);

    const version = assertValidCapabilityVersion(parsed.identity.version);

    const serialized = serializeCapabilityArtifact(parsed);

    const directory = this.capabilityDirectory(capabilityId);

    try {
      await mkdir(directory, {
        recursive: true,
      });
    } catch (error) {
      throw ioError('directory creation', directory, error);
    }

    const path = this.artifactPath(capabilityId, version);

    await this.atomicCreate(path, serialized);

    return path;
  }

  async load(capabilityId: string, version: string): Promise<CapabilityArtifact> {
    const path = this.artifactPath(capabilityId, version);

    let serialized: string;

    try {
      serialized = await readFile(path, {
        encoding: 'utf8',
      });
    } catch (error) {
      if (nodeErrorCode(error) === 'ENOENT') {
        throw new ArtifactError(
          'ARTIFACT_NOT_FOUND',
          `Artifact "${capabilityId}" version "${version}" was not found.`,
          {
            capabilityId,
            version,
            path,
          },
        );
      }

      throw ioError('read', path, error);
    }

    let raw: unknown;

    try {
      raw = JSON.parse(serialized);
    } catch {
      throw new ArtifactError(
        'ARTIFACT_IO_ERROR',
        `Stored artifact "${path}" contains invalid JSON.`,
        {
          operation: 'parse',
          path,
        },
      );
    }

    const artifact = parseCapabilityArtifact(raw);

    validateCapabilityArtifactSemantics(artifact);

    assertArtifactSafeToPersist(artifact);

    return artifact;
  }

  private async rootDirectoryExists(): Promise<boolean> {
    try {
      const rootStat = await stat(this.rootDir);

      if (!rootStat.isDirectory()) {
        throw new ArtifactError(
          'ARTIFACT_IO_ERROR',
          `Configured artifact root "${this.rootDir}" is not a directory.`,
          {
            operation: 'root validation',
            path: this.rootDir,
          },
        );
      }

      return true;
    } catch (error) {
      if (error instanceof ArtifactError) {
        throw error;
      }

      if (nodeErrorCode(error) === 'ENOENT') {
        return false;
      }

      throw ioError('root validation', this.rootDir, error);
    }
  }

  async listVersions(capabilityId: string): Promise<readonly string[]> {
    const directory = this.capabilityDirectory(capabilityId);

    let entries;

    try {
      entries = await readdir(directory, {
        withFileTypes: true,
      });
    } catch (error) {
      if (nodeErrorCode(error) === 'ENOENT') {
        /*
         * Windows may report ENOENT both when the
         * capability directory is absent and when a
         * parent path is actually a file.
         *
         * Validate the configured root before deciding
         * that this is simply an unknown capability.
         */
        const rootExists = await this.rootDirectoryExists();

        if (!rootExists) {
          return [];
        }

        return [];
      }

      throw ioError('version listing', directory, error);
    }

    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name.slice(0, -'.json'.length))
      .filter((version) => {
        const parsed = capabilityVersionSchema.safeParse(version);

        return parsed.success && parsed.data === version;
      })
      .sort(compareCapabilityVersions);
  }
}
