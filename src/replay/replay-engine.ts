import type { ArtifactStore, CapabilityArtifact, CapabilityStep } from '../artifact/index.js';

import type { JsonValue } from '../surface/index.js';

import { recordReplayEvidence, type ReplayEvidenceSink } from './replay-evidence.js';

import { prepareReplayInvocation } from './replay-preparation.js';

import type { ReplayRequest } from './replay-request.js';

import { ReplayOutputStore } from './output-store.js';

export interface ReplayExecutionContext {
  readonly artifact: CapabilityArtifact;
  readonly inputs: Readonly<Record<string, JsonValue>>;
  readonly outputStore: ReplayOutputStore;
}

export type ReplayOrderedStepResult =
  | {
      readonly status: 'success';
    }
  | {
      readonly status: 'business_outcome';
      readonly code: string;
      readonly details?: Readonly<Record<string, JsonValue>>;
    }
  | {
      readonly status: 'intervention_required';
      readonly reasonCode: string;
      readonly reason: string;
    }
  | {
      readonly status: 'failure';
      readonly code: string;
      readonly message: string;
    };

export interface ReplayStepExecutor {
  execute(
    step: CapabilityStep,
    stepIndex: number,
    context: ReplayExecutionContext,
  ): Promise<ReplayOrderedStepResult>;
}

export type ReplayOrderedExecutionResult =
  | {
      readonly status: 'success';
      readonly stepsExecuted: number;
      readonly outputs: Readonly<Record<string, JsonValue>>;
    }
  | {
      readonly status: 'business_outcome';
      readonly stepsExecuted: number;
      readonly stepId: string;
      readonly outcome: Extract<ReplayOrderedStepResult, { readonly status: 'business_outcome' }>;
    }
  | {
      readonly status: 'intervention_required';
      readonly stepsExecuted: number;
      readonly stepId: string;
      readonly intervention: Extract<
        ReplayOrderedStepResult,
        { readonly status: 'intervention_required' }
      >;
    }
  | {
      readonly status: 'failure';
      readonly stepsExecuted: number;
      readonly stepId: string | null;
      readonly error: Extract<ReplayOrderedStepResult, { readonly status: 'failure' }>;
    };

export interface ReplayEngineDependencies {
  readonly artifactStore: Pick<ArtifactStore, 'load'>;
  readonly stepExecutor: ReplayStepExecutor;
  readonly evidenceSink?: ReplayEvidenceSink;
}

/**
 * Deterministic capability replay orchestrator.
 *
 * This class never:
 *
 * - calls an LLM,
 * - asks for a next action,
 * - reorders artifact steps,
 * - skips steps based on UI appearance,
 * - synthesizes replacement actions.
 *
 * CapabilityArtifact.steps is the authoritative program order.
 */
export class ReplayEngine {
  constructor(private readonly dependencies: ReplayEngineDependencies) {}

  async runOrderedSteps(request: ReplayRequest): Promise<ReplayOrderedExecutionResult> {
    const evidenceSink = this.dependencies.evidenceSink;

    if (evidenceSink !== undefined) {
      await recordReplayEvidence({
        sink: evidenceSink,
        eventType: 'replay.started',
        step: 0,
        details: {
          capabilityId: request.capabilityId,
          version: request.version,
        },
      });
    }

    const prepared = await prepareReplayInvocation(this.dependencies.artifactStore, request);

    if (prepared.status === 'invalid_input') {
      if (evidenceSink !== undefined) {
        await recordReplayEvidence({
          sink: evidenceSink,
          eventType: 'replay.failed',
          step: 0,
          details: {
            code: 'INVALID_INPUT',
            message: prepared.error.message,
          },
        });
      }

      return {
        status: 'failure',
        stepsExecuted: 0,
        stepId: null,
        error: {
          status: 'failure',
          code: 'INVALID_INPUT',
          message: prepared.error.message,
        },
      };
    }

    if (evidenceSink !== undefined) {
      await recordReplayEvidence({
        sink: evidenceSink,
        eventType: 'artifact.loaded',
        step: 0,
        details: {
          capabilityId: prepared.artifact.identity.id,
          version: prepared.artifact.identity.version,
        },
      });

      await recordReplayEvidence({
        sink: evidenceSink,
        eventType: 'inputs.validated',
        step: 0,
        details: {
          inputNames: Object.keys(prepared.inputs),
        },
      });
    }

    const outputStore = new ReplayOutputStore(prepared.artifact);

    const context: ReplayExecutionContext = {
      artifact: prepared.artifact,
      inputs: prepared.inputs,
      outputStore,
    };

    let stepsExecuted = 0;

    for (let stepIndex = 0; stepIndex < prepared.artifact.steps.length; stepIndex += 1) {
      const step = prepared.artifact.steps[stepIndex];

      if (step === undefined) {
        if (evidenceSink !== undefined) {
          await recordReplayEvidence({
            sink: evidenceSink,
            eventType: 'replay.failed',
            step: stepIndex,
            details: {
              code: 'ACTION_FAILED',
              message: 'Artifact step ordering became inconsistent.',
            },
          });
        }

        return {
          status: 'failure',
          stepsExecuted,
          stepId: null,
          error: {
            status: 'failure',
            code: 'ACTION_FAILED',
            message: 'Artifact step ordering became inconsistent.',
          },
        };
      }

      if (evidenceSink !== undefined) {
        await recordReplayEvidence({
          sink: evidenceSink,
          eventType: 'step.started',
          step: stepIndex,
          stepId: step.id,
          details: {
            actionKind: step.action.kind,
            risk: step.risk,
          },
        });
      }

      const result = await this.dependencies.stepExecutor.execute(step, stepIndex, context);

      switch (result.status) {
        case 'success':
          stepsExecuted += 1;
          break;

        case 'business_outcome':
          if (evidenceSink !== undefined) {
            await recordReplayEvidence({
              sink: evidenceSink,
              eventType: 'business_outcome.detected',
              step: stepIndex,
              stepId: step.id,
              details: {
                code: result.code,
                ...(result.details === undefined
                  ? {}
                  : {
                      details: result.details,
                    }),
              },
            });
          }

          return {
            status: 'business_outcome',
            stepsExecuted,
            stepId: step.id,
            outcome: result,
          };

        case 'intervention_required':
          if (evidenceSink !== undefined) {
            await recordReplayEvidence({
              sink: evidenceSink,
              eventType: 'replay.intervention_required',
              step: stepIndex,
              stepId: step.id,
              details: {
                reasonCode: result.reasonCode,
                reason: result.reason,
              },
            });
          }

          return {
            status: 'intervention_required',
            stepsExecuted,
            stepId: step.id,
            intervention: result,
          };

        case 'failure':
          /*
           * Runtime hard-failure evidence is recorded by the concrete
           * executor where expected/observed state and screenshots are
           * available. Avoid emitting a duplicate, less-informative
           * replay.failed event here.
           */
          return {
            status: 'failure',
            stepsExecuted,
            stepId: step.id,
            error: result,
          };
      }
    }

    const outputs = outputStore.finalize();

    if (outputs.status === 'failure') {
      if (evidenceSink !== undefined) {
        await recordReplayEvidence({
          sink: evidenceSink,
          eventType: 'replay.failed',
          step: stepsExecuted,
          details: {
            code: outputs.error.code,
            message: outputs.error.message,
          },
        });
      }

      return {
        status: 'failure',
        stepsExecuted,
        stepId: null,
        error: {
          status: 'failure',
          code: outputs.error.code,
          message: outputs.error.message,
        },
      };
    }

    if (evidenceSink !== undefined) {
      await recordReplayEvidence({
        sink: evidenceSink,
        eventType: 'replay.completed',
        step: stepsExecuted,
        details: {
          stepsExecuted,
          outputNames: Object.keys(outputs.outputs),
        },
      });
    }

    return {
      status: 'success',
      stepsExecuted,
      outputs: outputs.outputs,
    };
  }
}
