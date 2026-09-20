import type { ArtifactStore, CapabilityArtifact } from '../artifact/index.js';

import type { ReplayRequest } from './replay-request.js';

/**
 * Production replay artifact-loading boundary.
 *
 * Replay never accepts a raw CapabilityArtifact object through this API.
 * ArtifactStore.load owns persisted-artifact schema, semantic, and security
 * validation before the artifact reaches replay execution.
 */
export async function loadReplayArtifact(
  store: Pick<ArtifactStore, 'load'>,
  request: Pick<ReplayRequest, 'capabilityId' | 'version'>,
): Promise<CapabilityArtifact> {
  return store.load(request.capabilityId, request.version);
}
