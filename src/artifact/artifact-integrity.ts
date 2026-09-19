import { createHash } from 'node:crypto';

import type { CapabilityArtifact } from './capability-artifact.js';

import { serializeCapabilityArtifact } from './artifact-serialization.js';

export function sha256Bytes(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256CapabilityArtifact(artifact: CapabilityArtifact): string {
  return sha256Bytes(serializeCapabilityArtifact(artifact));
}
