import { z } from 'zod';

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

export function isSupportedArtifactSchemaVersion(value: string): boolean {
  const parsed = artifactSchemaVersionSchema.safeParse(value);

  if (!parsed.success) {
    return false;
  }

  const candidate = parseArtifactSchemaVersion(parsed.data);
  const current = parseArtifactSchemaVersion(CURRENT_ARTIFACT_SCHEMA_VERSION);

  return candidate.major === current.major && candidate.minor <= current.minor;
}
