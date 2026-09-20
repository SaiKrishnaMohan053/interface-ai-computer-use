import type { CapabilityArtifact } from '../artifact/index.js';

import type { JsonValue } from '../surface/index.js';

export type ReplayPipelineFailureCode = 'INVALID_INPUT' | 'ACTION_FAILED' | 'CHECKPOINT_FAILED';

export type ReplayPipelineResult =
  | {
      readonly status: 'success';

      readonly outputs: Readonly<Record<string, JsonValue>>;
    }
  | {
      readonly status: 'failure';

      readonly error: {
        readonly code: ReplayPipelineFailureCode;

        readonly message: string;

        readonly details?: Readonly<Record<string, JsonValue>>;
      };
    };

export interface ReplayPipelineRequest {
  readonly capabilityId: string;

  readonly version: string;

  readonly input: Readonly<Record<string, unknown>>;
}

export type ReplayInputValidationResult =
  | {
      readonly status: 'valid';

      readonly inputs: Readonly<Record<string, JsonValue>>;
    }
  | {
      readonly status: 'invalid';

      readonly message: string;

      readonly details?: Readonly<Record<string, JsonValue>>;
    };

export type ReplayStepExecutionResult =
  | {
      readonly status: 'success';

      readonly outputs: Readonly<Record<string, JsonValue>>;
    }
  | {
      readonly status: 'failure';

      readonly message: string;

      readonly details?: Readonly<Record<string, JsonValue>>;
    };

export type ReplaySuccessCheckResult =
  | {
      readonly status: 'passed';
    }
  | {
      readonly status: 'failed';

      readonly message: string;

      readonly details?: Readonly<Record<string, JsonValue>>;
    };

export interface ReplayPipelineDependencies {
  readonly loadArtifact: (capabilityId: string, version: string) => Promise<CapabilityArtifact>;

  readonly validateInputs: (
    artifact: CapabilityArtifact,
    input: Readonly<Record<string, unknown>>,
  ) => ReplayInputValidationResult;

  readonly bindInputs: (
    artifact: CapabilityArtifact,
    inputs: Readonly<Record<string, JsonValue>>,
  ) => Readonly<Record<string, JsonValue>>;

  readonly executeSteps: (
    artifact: CapabilityArtifact,
    boundInputs: Readonly<Record<string, JsonValue>>,
  ) => Promise<ReplayStepExecutionResult>;

  readonly evaluateSuccessCondition: (
    artifact: CapabilityArtifact,
    outputs: Readonly<Record<string, JsonValue>>,
  ) => Promise<ReplaySuccessCheckResult>;
}

/**
 * Deterministic replay orchestration boundary.
 *
 * This layer intentionally contains no:
 *
 * - browser implementation
 * - target resolution logic
 * - policy logic
 * - output parsing logic
 * - LLM/model dependency
 *
 * Those behaviors remain delegated to the existing
 * replay/runtime helpers.
 */
export async function executeReplayPipeline(
  request: ReplayPipelineRequest,
  dependencies: ReplayPipelineDependencies,
): Promise<ReplayPipelineResult> {
  const artifact = await dependencies.loadArtifact(request.capabilityId, request.version);

  const validation = dependencies.validateInputs(artifact, request.input);

  if (validation.status === 'invalid') {
    return {
      status: 'failure',

      error: {
        code: 'INVALID_INPUT',

        message: validation.message,

        ...(validation.details === undefined
          ? {}
          : {
              details: validation.details,
            }),
      },
    };
  }

  const boundInputs = dependencies.bindInputs(artifact, validation.inputs);

  const stepResult = await dependencies.executeSteps(artifact, boundInputs);

  if (stepResult.status === 'failure') {
    return {
      status: 'failure',

      error: {
        code: 'ACTION_FAILED',

        message: stepResult.message,

        ...(stepResult.details === undefined
          ? {}
          : {
              details: stepResult.details,
            }),
      },
    };
  }

  const success = await dependencies.evaluateSuccessCondition(artifact, stepResult.outputs);

  if (success.status === 'failed') {
    return {
      status: 'failure',

      error: {
        code: 'CHECKPOINT_FAILED',

        message: success.message,

        ...(success.details === undefined
          ? {}
          : {
              details: success.details,
            }),
      },
    };
  }

  return {
    status: 'success',

    outputs: stepResult.outputs,
  };
}
