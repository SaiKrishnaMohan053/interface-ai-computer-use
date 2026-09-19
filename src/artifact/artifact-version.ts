import { z } from 'zod';

import { ArtifactError } from './artifact-errors.js';

export const CURRENT_ARTIFACT_SCHEMA_VERSION = '1.0';

const schemaVersionPattern = /^(\d+)\.(\d+)$/;

const capabilityVersionPattern = /^(\d+)\.(\d+)\.(\d+)$/;

export const artifactSchemaVersionSchema = z
  .string()
  .trim()
  .regex(schemaVersionPattern, 'Artifact schema version must use MAJOR.MINOR format');

export const capabilityVersionSchema = z
  .string()
  .trim()
  .regex(capabilityVersionPattern, 'Capability version must use MAJOR.MINOR.PATCH format');

export interface ParsedSchemaVersion {
  readonly major: number;
  readonly minor: number;
}

export interface ParsedCapabilityVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/**
 * Capability versions use semantic versioning.
 *
 * PATCH
 * - locator improvement
 * - checkpoint improvement
 * - recovery improvement
 * - equivalent internal implementation improvement
 * - no caller-visible contract break
 *
 * MINOR
 * - backward-compatible capability enhancement
 * - backward-compatible input enhancement
 * - backward-compatible output enhancement
 * - existing callers remain valid
 *
 * MAJOR
 * - breaking input/output contract change
 * - breaking capability behavior change
 * - existing callers may need modification
 */
export const CAPABILITY_VERSIONING_POLICY = Object.freeze({
  PATCH:
    'Locator, checkpoint, recovery, or equivalent internal improvement with no caller contract break.',

  MINOR: 'Backward-compatible capability, input, or output enhancement.',

  MAJOR: 'Breaking capability contract or behavior change.',
});

export function parseArtifactSchemaVersion(value: string): ParsedSchemaVersion {
  const parsed = artifactSchemaVersionSchema.parse(value);

  const match = schemaVersionPattern.exec(parsed);

  if (match === null) {
    throw new Error('Artifact schema version could not be parsed');
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
  };
}

export function parseCapabilityVersion(value: string): ParsedCapabilityVersion {
  const parsed = capabilityVersionSchema.parse(value);

  const match = capabilityVersionPattern.exec(parsed);

  if (match === null) {
    throw new Error('Capability version could not be parsed');
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/**
 * Storage-facing strict capability version validation.
 *
 * Unlike the general Zod schema, storage requires the
 * supplied path value to already be canonical. Values
 * with surrounding whitespace are therefore rejected.
 */
export function assertValidCapabilityVersion(value: string): string {
  const parsed = capabilityVersionSchema.safeParse(value);

  if (!parsed.success || parsed.data !== value) {
    throw new ArtifactError(
      'ARTIFACT_VERSION_INVALID',
      `Invalid capability version "${value}". Expected canonical MAJOR.MINOR.PATCH format.`,
      {
        version: value,
      },
    );
  }

  return parsed.data;
}

export function compareCapabilityVersions(left: string, right: string): number {
  const leftVersion = parseCapabilityVersion(left);

  const rightVersion = parseCapabilityVersion(right);

  if (leftVersion.major !== rightVersion.major) {
    return leftVersion.major - rightVersion.major;
  }

  if (leftVersion.minor !== rightVersion.minor) {
    return leftVersion.minor - rightVersion.minor;
  }

  return leftVersion.patch - rightVersion.patch;
}

export function isSupportedArtifactSchemaVersion(value: string): boolean {
  const parsed = artifactSchemaVersionSchema.safeParse(value);

  if (!parsed.success) {
    return false;
  }

  const candidate = parseArtifactSchemaVersion(parsed.data);

  const current = parseArtifactSchemaVersion(CURRENT_ARTIFACT_SCHEMA_VERSION);

  return candidate.major === current.major && candidate.minor <= current.minor;
}
