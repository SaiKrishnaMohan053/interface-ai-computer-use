import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { dirname, join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ArtifactCompiler,
  parseCapabilityArtifact,
  serializeCapabilityArtifact,
  sha256Bytes,
  sha256CapabilityArtifact,
  validateCapabilityArtifactSemantics,
} from '../../src/artifact/index.js';

import { createCompileOptions } from '../helpers/artifact-compiler-fixture.js';

import { FROZEN_RUN_ID, loadFrozenSource } from '../helpers/frozen-discovery-source.js';

const ARTIFACT_RELATIVE_PATH = 'artifacts/lookup_savings_balance/1.0.0.json';

const HASH_RELATIVE_PATH = 'artifacts/lookup_savings_balance/1.0.0.sha256';

const EVIDENCE_DIRECTORY = join(process.cwd(), 'evidence', 'artifact-compilation');

async function writeDeterministicFile(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), {
    recursive: true,
  });

  try {
    const existing = await readFile(path, 'utf8');

    if (existing === contents) {
      return;
    }
  } catch {
    // File does not exist yet.
  }

  await writeFile(path, contents, 'utf8');
}

describe('artifact compilation reviewer evidence', () => {
  it('writes deterministic final artifact integrity and reviewer-safe evidence', async () => {
    const source = await loadFrozenSource();

    const artifact = new ArtifactCompiler().compile(source, createCompileOptions());

    const validated = parseCapabilityArtifact(artifact);

    validateCapabilityArtifactSemantics(validated);

    const serialized = serializeCapabilityArtifact(validated);

    const artifactHash = sha256CapabilityArtifact(validated);

    expect(artifactHash).toBe(sha256Bytes(serialized));

    const artifactPath = join(process.cwd(), ARTIFACT_RELATIVE_PATH);

    const hashPath = join(process.cwd(), HASH_RELATIVE_PATH);

    await writeDeterministicFile(artifactPath, serialized);

    await writeDeterministicFile(hashPath, `${artifactHash}  1.0.0.json\n`);

    await mkdir(EVIDENCE_DIRECTORY, {
      recursive: true,
    });

    const compileResult = {
      status: 'success',

      capabilityId: validated.identity.id,

      capabilityVersion: validated.identity.version,

      schemaVersion: validated.schemaVersion,

      discoveryRunId: FROZEN_RUN_ID,

      compilerVersion: validated.provenance.compilerVersion,

      compiledAt: validated.provenance.compiledAt,

      stepIds: validated.steps.map((step) => step.id),

      artifactPath: ARTIFACT_RELATIVE_PATH,
    };

    const validationResult = {
      status: 'success',

      schemaValidation: 'passed',

      semanticValidation: 'passed',

      persistenceSafety: 'passed',

      deterministicSerialization: 'passed',

      checks: {
        capabilityId: validated.identity.id,

        inputNames: validated.inputs.map((input) => input.name),

        outputNames: validated.outputs.map((output) => output.name),

        businessOutcomeCodes: validated.knownBusinessOutcomes?.map((outcome) => outcome.code) ?? [],

        stepCount: validated.steps.length,
      },
    };

    const artifactReference = {
      capabilityId: validated.identity.id,

      version: validated.identity.version,

      artifactPath: ARTIFACT_RELATIVE_PATH,

      sha256: artifactHash,

      hashAlgorithm: 'SHA-256',

      provenance: {
        discoveryRunId: validated.provenance.discoveryRunId,

        compilerVersion: validated.provenance.compilerVersion,
      },
    };

    const compileResultPath = join(EVIDENCE_DIRECTORY, 'compile-result.json');

    const validationResultPath = join(EVIDENCE_DIRECTORY, 'validation-result.json');

    const artifactReferencePath = join(EVIDENCE_DIRECTORY, 'artifact-reference.json');

    await writeDeterministicFile(compileResultPath, `${JSON.stringify(compileResult, null, 2)}\n`);

    await writeDeterministicFile(
      validationResultPath,
      `${JSON.stringify(validationResult, null, 2)}\n`,
    );

    await writeDeterministicFile(
      artifactReferencePath,
      `${JSON.stringify(artifactReference, null, 2)}\n`,
    );

    const evidenceFiles = [compileResultPath, validationResultPath, artifactReferencePath];

    const evidenceHashes = await Promise.all(
      evidenceFiles.map(async (path) => {
        const bytes = await readFile(path);

        return {
          path,
          hash: sha256Bytes(bytes),
        };
      }),
    );

    const sums = [
      `${artifactHash}  ../../${ARTIFACT_RELATIVE_PATH}`,
      ...evidenceHashes.map(
        ({ path, hash }) => `${hash}  ${relative(EVIDENCE_DIRECTORY, path).replaceAll('\\', '/')}`,
      ),
    ].join('\n');

    await writeDeterministicFile(join(EVIDENCE_DIRECTORY, 'SHA256SUMS.txt'), `${sums}\n`);

    const readme = `# Artifact Compilation Evidence

This package documents deterministic compilation of the genuine successful Phase 2 discovery run into the reusable capability artifact \`lookup_savings_balance\` version \`1.0.0\`.

## Source

- Discovery run: \`${FROZEN_RUN_ID}\`
- Source package: \`evidence/discovery-success/\`
- Raw discovery trace is intentionally not duplicated here.

## Result

- Artifact: \`${ARTIFACT_RELATIVE_PATH}\`
- Schema validation: passed
- Semantic validation: passed
- Persistence safety: passed
- SHA-256: \`${artifactHash}\`

## Files

- \`compile-result.json\`: concise compilation result
- \`validation-result.json\`: validation summary
- \`artifact-reference.json\`: final artifact identity, path, provenance, and hash
- \`SHA256SUMS.txt\`: integrity hashes for reviewer-facing outputs

This evidence package intentionally excludes raw model responses, decision rationale, browser/runtime handles, screenshots, observations, session state, and invocation-specific discovery values.
`;

    await writeDeterministicFile(join(EVIDENCE_DIRECTORY, 'README.md'), readme);

    expect(validated.identity.id).toBe('lookup_savings_balance');

    expect(artifactHash).toMatch(/^[a-f0-9]{64}$/u);
  });
});
