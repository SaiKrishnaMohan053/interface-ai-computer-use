import type { ArtifactStore, CapabilityArtifact } from '../artifact/index.js';

import { loadReplayArtifact } from './artifact-loader.js';

import { validateReplayInvocationInputs } from './invocation-inputs.js';

import type { ReplayInvalidInput } from './invocation-inputs.js';

import type { ReplayRequest } from './replay-request.js';

import type { JsonValue } from '../surface/index.js';

export type ReplayPreparationResult =
  | {
      readonly status: 'ready';
      readonly artifact: CapabilityArtifact;
      readonly inputs: Readonly<Record<string, JsonValue>>;
    }
  | {
      readonly status: 'invalid_input';
      readonly error: ReplayInvalidInput;
    };

/**
 * Performs every replay validation that must happen before creation
 * of a browser-backed REPLAY session.
 */
export async function prepareReplayInvocation(
  store: Pick<ArtifactStore, 'load'>,
  request: ReplayRequest,
): Promise<ReplayPreparationResult> {
  const artifact = await loadReplayArtifact(store, request);

  const inputValidation = validateReplayInvocationInputs(artifact, request.inputs);

  if (inputValidation.status === 'invalid') {
    return {
      status: 'invalid_input',
      error: inputValidation.error,
    };
  }

  return {
    status: 'ready',
    artifact,
    inputs: inputValidation.inputs,
  };
}
