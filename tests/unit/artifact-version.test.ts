import { describe, expect, it } from 'vitest';

import {
  CURRENT_ARTIFACT_SCHEMA_VERSION,
  artifactSchemaVersionSchema,
  capabilityVersionSchema,
  isSupportedArtifactSchemaVersion,
  parseArtifactSchemaVersion,
  parseCapabilityVersion,
} from '../../src/artifact/index.js';

describe('artifact versioning', () => {
  it('uses MAJOR.MINOR for artifact schema versions', () => {
    expect(artifactSchemaVersionSchema.parse('1.0')).toBe('1.0');
    expect(artifactSchemaVersionSchema.parse('2.3')).toBe('2.3');

    expect(artifactSchemaVersionSchema.safeParse('1').success).toBe(false);
    expect(artifactSchemaVersionSchema.safeParse('1.0.0').success).toBe(false);
  });

  it('uses MAJOR.MINOR.PATCH for capability versions', () => {
    expect(capabilityVersionSchema.parse('1.0.0')).toBe('1.0.0');
    expect(capabilityVersionSchema.parse('2.4.7')).toBe('2.4.7');

    expect(capabilityVersionSchema.safeParse('1.0').success).toBe(false);
    expect(capabilityVersionSchema.safeParse('v1.0.0').success).toBe(false);
  });

  it('parses artifact schema versions independently', () => {
    expect(parseArtifactSchemaVersion('3.12')).toEqual({
      major: 3,
      minor: 12,
    });
  });

  it('parses capability versions independently', () => {
    expect(parseCapabilityVersion('3.12.4')).toEqual({
      major: 3,
      minor: 12,
      patch: 4,
    });
  });

  it('declares the current artifact schema version explicitly', () => {
    expect(CURRENT_ARTIFACT_SCHEMA_VERSION).toBe('1.0');
  });

  it('accepts only supported artifact schema versions', () => {
    expect(isSupportedArtifactSchemaVersion('1.0')).toBe(true);

    expect(isSupportedArtifactSchemaVersion('1.1')).toBe(false);
    expect(isSupportedArtifactSchemaVersion('2.0')).toBe(false);
    expect(isSupportedArtifactSchemaVersion('0.9')).toBe(false);
    expect(isSupportedArtifactSchemaVersion('invalid')).toBe(false);
  });
});
