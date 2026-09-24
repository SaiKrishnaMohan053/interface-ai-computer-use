import { createHash } from 'node:crypto';

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

import { join } from 'node:path';

import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { verifyHumanHandoffEvidenceIntegrity } from '../../src/intervention/intervention-evidence-integrity.js';

const temporaryDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'interface-ai-handoff-integrity-'));

  temporaryDirectories.push(directory);

  return directory;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function writePackage(directory: string): Promise<void> {
  await mkdir(join(directory, 'screenshots'), {
    recursive: true,
  });

  const files = new Map<string, string>([
    ['README.md', '# Synthetic human handoff\n'],
    ['run.json', '{"runId":"run-1"}\n'],
    ['intervention.json', '{"id":"intervention-1"}\n'],
    ['events.jsonl', '{"eventType":"intervention"}\n'],
    ['result.json', '{"status":"success"}\n'],
    ['screenshots/screenshot-0001.png', 'synthetic-png-bytes'],
  ]);

  for (const [relativePath, content] of files) {
    await writeFile(join(directory, relativePath), content);
  }

  const manifest = [...files.entries()]
    .map(([relativePath, content]) => `${sha256(content)}  ${relativePath}`)
    .sort()
    .join('\n');

  await writeFile(join(directory, 'SHA256SUMS.txt'), `${manifest}\n`);
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

describe('human handoff evidence integrity', () => {
  it('verifies every manifested package file', async () => {
    const directory = await createTempDirectory();

    await writePackage(directory);

    const result = await verifyHumanHandoffEvidenceIntegrity(directory);

    expect(result.entries.map((entry) => entry.relativePath)).toEqual([
      'README.md',
      'events.jsonl',
      'intervention.json',
      'result.json',
      'run.json',
      'screenshots/screenshot-0001.png',
    ]);

    for (const entry of result.entries) {
      expect(entry.actualSha256).toBe(entry.expectedSha256);
    }
  });

  it('fails when a manifested file is modified', async () => {
    const directory = await createTempDirectory();

    await writePackage(directory);

    await writeFile(join(directory, 'result.json'), '{"status":"tampered"}\n');

    await expect(verifyHumanHandoffEvidenceIntegrity(directory)).rejects.toThrow(
      'SHA-256 mismatch for result.json',
    );
  });

  it('fails when an extra unmanifested file appears', async () => {
    const directory = await createTempDirectory();

    await writePackage(directory);

    await writeFile(join(directory, 'unexpected.txt'), 'not in manifest');

    await expect(verifyHumanHandoffEvidenceIntegrity(directory)).rejects.toThrow(
      'manifest does not match package contents',
    );
  });

  it('fails when a manifest entry points outside the package', async () => {
    const directory = await createTempDirectory();

    await writePackage(directory);

    const manifestPath = join(directory, 'SHA256SUMS.txt');

    const original = await readFile(manifestPath, 'utf8');

    await writeFile(manifestPath, `${original}${sha256('escape')}  ../escape.txt\n`);

    await expect(verifyHumanHandoffEvidenceIntegrity(directory)).rejects.toThrow(
      'Invalid SHA-256 manifest path',
    );
  });
});
