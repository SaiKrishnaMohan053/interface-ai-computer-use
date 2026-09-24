import { createHash } from 'node:crypto';

import { readFile, readdir, stat } from 'node:fs/promises';

import { relative, resolve, sep } from 'node:path';

export interface HumanHandoffIntegrityEntry {
  readonly relativePath: string;
  readonly expectedSha256: string;
  readonly actualSha256: string;
}

export interface HumanHandoffIntegrityResult {
  readonly packageDirectory: string;
  readonly manifestPath: string;
  readonly entries: readonly HumanHandoffIntegrityEntry[];
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function normalizeRelativePath(value: string): string {
  const normalized = value.replaceAll('\\', '/').trim();

  if (
    normalized.length === 0 ||
    normalized.startsWith('/') ||
    normalized.includes('\0') ||
    normalized.split('/').some((segment) => segment === '..')
  ) {
    throw new Error(`Invalid SHA-256 manifest path: ${JSON.stringify(value)}`);
  }

  return normalized;
}

function resolveContained(root: string, relativePath: string): string {
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(absoluteRoot, relativePath);

  const rootPrefix = absoluteRoot.endsWith(sep) ? absoluteRoot : `${absoluteRoot}${sep}`;

  if (absolutePath !== absoluteRoot && !absolutePath.startsWith(rootPrefix)) {
    throw new Error(`Manifest path escapes package directory: ${relativePath}`);
  }

  return absolutePath;
}

async function sha256File(path: string): Promise<string> {
  const bytes = await readFile(path);

  return createHash('sha256').update(bytes).digest('hex');
}

async function listFiles(directory: string): Promise<string[]> {
  const result: string[] = [];

  async function visit(current: string): Promise<void> {
    const entries = await readdir(current, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      const absolutePath = resolve(current, entry.name);

      if (entry.isDirectory()) {
        await visit(absolutePath);

        continue;
      }

      if (!entry.isFile()) {
        throw new Error(`Unsupported filesystem entry in evidence package: ${absolutePath}`);
      }

      const relativePath = relative(directory, absolutePath).replaceAll('\\', '/');

      if (relativePath !== 'SHA256SUMS.txt') {
        result.push(relativePath);
      }
    }
  }

  await visit(directory);

  return result.sort();
}

function parseManifest(content: string): ReadonlyMap<string, string> {
  const entries = new Map<string, string>();

  const lines = content.split(/\r?\n/u).filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    throw new Error('SHA256SUMS.txt must contain at least one entry');
  }

  for (const line of lines) {
    const match = /^([a-fA-F0-9]{64}) {2}(.+)$/u.exec(line);

    if (match === null) {
      throw new Error(`Invalid SHA-256 manifest line: ${line}`);
    }

    const hash = match[1]?.toLowerCase();
    const rawPath = match[2];

    if (hash === undefined || rawPath === undefined || !SHA256_PATTERN.test(hash)) {
      throw new Error(`Invalid SHA-256 manifest line: ${line}`);
    }

    const relativePath = normalizeRelativePath(rawPath);

    if (relativePath === 'SHA256SUMS.txt') {
      throw new Error('SHA256SUMS.txt must not hash itself');
    }

    if (entries.has(relativePath)) {
      throw new Error(`Duplicate SHA-256 manifest entry: ${relativePath}`);
    }

    entries.set(relativePath, hash);
  }

  return entries;
}

/**
 * Verifies a frozen human-handoff evidence package using its SHA256SUMS.txt.
 *
 * Integrity is intentionally local and reviewable:
 * - every package file except SHA256SUMS.txt must be listed exactly once
 * - every listed file must exist inside the package directory
 * - every SHA-256 digest must match
 * - extra or missing files fail verification
 *
 * This is not authenticity or non-repudiation. No signatures or PKI are used.
 */
export async function verifyHumanHandoffEvidenceIntegrity(
  packageDirectory = 'evidence/human-handoff',
): Promise<HumanHandoffIntegrityResult> {
  const absolutePackageDirectory = resolve(packageDirectory);

  const packageStats = await stat(absolutePackageDirectory);

  if (!packageStats.isDirectory()) {
    throw new Error(`Human handoff evidence path is not a directory: ${absolutePackageDirectory}`);
  }

  const manifestPath = resolve(absolutePackageDirectory, 'SHA256SUMS.txt');

  const manifestContent = await readFile(manifestPath, 'utf8');

  const manifest = parseManifest(manifestContent);

  const actualFiles = await listFiles(absolutePackageDirectory);

  const manifestFiles = [...manifest.keys()].sort();

  if (JSON.stringify(actualFiles) !== JSON.stringify(manifestFiles)) {
    const missingFromManifest = actualFiles.filter((path) => !manifest.has(path));

    const missingFromPackage = manifestFiles.filter((path) => !actualFiles.includes(path));

    throw new Error(
      [
        'Human handoff evidence manifest does not match package contents.',
        `Unmanifested files: ${missingFromManifest.join(', ') || 'none'}.`,
        `Missing files: ${missingFromPackage.join(', ') || 'none'}.`,
      ].join(' '),
    );
  }

  const verified: HumanHandoffIntegrityEntry[] = [];

  for (const relativePath of manifestFiles) {
    const expectedSha256 = manifest.get(relativePath);

    if (expectedSha256 === undefined) {
      throw new Error(`Manifest entry disappeared during verification: ${relativePath}`);
    }

    const absolutePath = resolveContained(absolutePackageDirectory, relativePath);

    const actualSha256 = await sha256File(absolutePath);

    if (actualSha256 !== expectedSha256) {
      throw new Error(
        `SHA-256 mismatch for ${relativePath}: expected ${expectedSha256}, got ${actualSha256}`,
      );
    }

    verified.push({
      relativePath,
      expectedSha256,
      actualSha256,
    });
  }

  return Object.freeze({
    packageDirectory: absolutePackageDirectory,
    manifestPath,
    entries: Object.freeze(verified.map((entry) => Object.freeze(entry))),
  });
}
