import { randomUUID } from 'node:crypto';

import { ConditionEvaluator } from '../conditions/index.js';

import { parseRuntimeResult } from '../runtime/index.js';

import type {
  CoordinatedRunContext,
  RunCoordinator,
  RuntimeFailureCode,
} from '../runtime/index.js';

import type {
  ActionResult,
  EvidenceReference,
  JsonValue,
  ResolvedTarget,
  SurfaceFailure,
  SurfaceObservation,
} from '../surface/index.js';

import { TargetResolver } from '../targeting/index.js';

import type { TargetStrategy } from '../targeting/index.js';

import type {
  AgentActionOutcome,
  AgentConditionOutcome,
  AgentError,
  AgentObservation,
} from './agent-observation.js';

import { getDiscoveryDecisionTarget, translateDiscoveryDecision } from './action-translator.js';

import type { TranslatableDiscoveryDecision } from './action-translator.js';

import { evaluateDiscoveryActionPolicy } from './discovery-policy-gate.js';

import { recordDiscoveryEvidenceEvent } from './discovery-evidence-events.js';

import { withDiscoverySteps } from './discovery-result.js';

import { discoveryDecisionRationale, recordDiscoveryTrace } from './discovery-trace.js';

import { verifyDiscoveryGoalCompletion } from './completion-verifier.js';

import { parseDiscoveryRequest, resolveDiscoveryRunConfig } from './contracts.js';

import type { DiscoveryDecision } from './decision.js';

import { createDiscoveryIntervention } from './escalation.js';

import type { DiscoveryIntervention } from './escalation.js';

import { createDiscoveryModelInput, DiscoveryModelRequestError } from './model/index.js';

import type { DiscoveryDecisionModel, DiscoveryHistoryEntry } from './model/index.js';

import {
  DEFAULT_DISCOVERY_MODEL_FORMAT_RETRIES,
  DiscoveryDecisionValidationError,
  requestValidatedDiscoveryDecision,
} from './model-decision-validation.js';

import { projectObservationForAgent } from './observation-projector.js';

import { createDiscoveryObservationFingerprint } from './observation-fingerprint.js';

import { detectDiscoveryApplicationState } from './runtime-application-state.js';

import { extractDiscoveryRead, retainDiscoveryExtraction } from './read-extraction.js';

import {
  appendDiscoveryStep,
  createDiscoveryRunState,
  recordDiscoveryObservationFingerprint,
} from './run-state.js';

import type { DiscoveryResult, DiscoveryRunState, DiscoveryStepRecord } from './run-state.js';

import {
  evaluateDiscoveryLoopBudget,
  isHardDiscoveryActionFailure,
} from './stopping-conditions.js';

import {
  planDiscoveryObservationScreenshot,
  type DiscoveryScreenshotEvidenceMode,
} from './screenshot-strategy.js';

import type { InterventionController } from '../intervention/index.js';

export const DEFAULT_DISCOVERY_MAX_STEPS = 25;

export const DEFAULT_DISCOVERY_MAX_REPEATED_STATES = 3;

export const DEFAULT_DISCOVERY_OPERATION_TIMEOUT_MS = 15_000;

export const DEFAULT_DISCOVERY_CONDITION_POLL_INTERVAL_MS = 100;

const RECENT_LIMIT = 5;

type DiscoveryContext = CoordinatedRunContext<TargetStrategy>;

type NonTerminalDecision = Exclude<DiscoveryDecision, { readonly kind: 'complete' | 'escalate' }>;

interface RuntimeFailureInput {
  readonly code: RuntimeFailureCode;

  readonly message: string;

  readonly expected: JsonValue;

  readonly observed: JsonValue;
}

interface WorkingMemory {
  recentAction: AgentActionOutcome | null;

  recentCondition: AgentConditionOutcome | null;

  recentError: AgentError | null;

  readonly history: DiscoveryHistoryEntry[];
}

export type DiscoveryCoordinator = Pick<
  RunCoordinator<TargetStrategy>,
  'start' | 'finish' | 'fail'
>;

export interface DiscoveryEngineDependencies {
  readonly coordinator: DiscoveryCoordinator;

  readonly model: DiscoveryDecisionModel;

  readonly interventionController?: InterventionController;
}

export interface DiscoveryEngineOptions {
  maxSteps?: number;

  maxRepeatedStates?: number;

  operationTimeoutMs?: number;

  conditionPollIntervalMs?: number;

  observationMaxTextLength?: number;

  observationMaxControls?: number;

  modelFormatRetries?: number;

  createId?: () => string;

  now?: () => Date;
}

export interface DiscoveryRunOptions {
  signal?: AbortSignal;

  runId?: string;

  evidenceRoot?: string;

  headed?: boolean;

  screenshotEvidence?: DiscoveryScreenshotEvidenceMode;
}

interface ResolvedOptions {
  readonly maxSteps: number;

  readonly maxRepeatedStates: number;

  readonly operationTimeoutMs: number;

  readonly conditionPollIntervalMs: number;

  readonly observationMaxTextLength: number;

  readonly observationMaxControls: number;

  readonly modelFormatRetries: number;
}

function boundedInteger(value: number, field: string, maximum: number): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${field} must be an integer between 1 and ${maximum}`);
  }

  return value;
}

function boundedNonnegativeInteger(value: number, field: string, maximum: number): number {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${field} must be an integer between 0 and ${maximum}`);
  }

  return value;
}

function locationOf(observation: AgentObservation): string {
  return observation.location.kind === 'web'
    ? observation.location.url
    : `${observation.location.applicationId}: ${observation.location.windowTitle}`;
}

function buildInterventionObservedState(intervention: DiscoveryIntervention): string {
  const source =
    typeof intervention.context.source === 'string' ? intervention.context.source : 'unknown';

  const location =
    typeof intervention.context.location === 'string' ? intervention.context.location : 'unknown';

  return [`source=${source}`, `location=${location}`, `reason=${intervention.message}`].join('; ');
}

function mapSurfaceFailure(error: SurfaceFailure): RuntimeFailureInput {
  let code: RuntimeFailureCode;

  switch (error.code) {
    case 'TARGET_NOT_FOUND': {
      code = 'TARGET_NOT_FOUND';

      break;
    }

    case 'TARGET_AMBIGUOUS': {
      code = 'TARGET_AMBIGUOUS';

      break;
    }

    case 'NAVIGATION_FAILED': {
      code = 'NAVIGATION_FAILED';

      break;
    }

    case 'ACTION_FAILED': {
      code = 'ACTION_FAILED';

      break;
    }

    case 'CONDITION_TIMEOUT': {
      code = 'RUN_TIMEOUT';

      break;
    }

    case 'CONDITION_EVALUATION_FAILED': {
      code = 'CHECKPOINT_FAILED';

      break;
    }

    case 'SURFACE_UNAVAILABLE': {
      code = 'APPLICATION_ERROR';

      break;
    }

    case 'STALE_TARGET': {
      code = 'ACTION_FAILED';

      break;
    }

    case 'UNSUPPORTED_OPERATION': {
      code = 'ACTION_FAILED';

      break;
    }
  }

  return {
    code,

    message: error.message,

    expected: error.expected,

    observed: error.observed,
  };
}

function actionSummary(decision: TranslatableDiscoveryDecision): string {
  if (decision.kind === 'navigate') return `navigate to ${decision.destination}`;

  if (decision.kind === 'dismiss') {
    return decision.dialog.kind === 'native'
      ? 'dismiss native dialog'
      : `dismiss ${decision.dialog.target.description}`;
  }

  return `${decision.kind} ${decision.target.description}`;
}

function appendHistory(memory: WorkingMemory, entry: DiscoveryHistoryEntry): void {
  memory.history.push(entry);

  if (memory.history.length > RECENT_LIMIT) memory.history.shift();
}

function isAtEntry(observation: SurfaceObservation, entryUrl: string): boolean {
  if (observation.location.kind !== 'web') return false;

  try {
    const current = new URL(observation.location.url);

    const entry = new URL(entryUrl);

    current.hash = '';

    entry.hash = '';

    return current.href === entry.href;
  } catch {
    return false;
  }
}

function assertDiscoveryActionOwnership(context: DiscoveryContext): void {
  if (context.mode !== 'DISCOVERY') {
    throw new Error(`Discovery action requires DISCOVERY mode; received ${context.mode}`);
  }

  /*
   * SessionManager.access() is the hard authorization boundary.
   * It rejects paused sessions and any non-DISCOVERY owner,
   * including HUMAN ownership.
   */
  context.sessionManager.access('DISCOVERY');
}

export class DiscoveryEngine {
  private readonly options: ResolvedOptions;

  private readonly createId: () => string;

  private readonly now: () => Date;

  constructor(
    private readonly dependencies: DiscoveryEngineDependencies,

    options: DiscoveryEngineOptions = {},
  ) {
    this.options = {
      maxSteps: boundedInteger(options.maxSteps ?? DEFAULT_DISCOVERY_MAX_STEPS, 'maxSteps', 100),

      maxRepeatedStates: boundedInteger(
        options.maxRepeatedStates ?? DEFAULT_DISCOVERY_MAX_REPEATED_STATES,

        'maxRepeatedStates',

        100,
      ),

      operationTimeoutMs: boundedInteger(
        options.operationTimeoutMs ?? DEFAULT_DISCOVERY_OPERATION_TIMEOUT_MS,

        'operationTimeoutMs',

        15 * 60_000,
      ),

      conditionPollIntervalMs: boundedInteger(
        options.conditionPollIntervalMs ?? DEFAULT_DISCOVERY_CONDITION_POLL_INTERVAL_MS,

        'conditionPollIntervalMs',

        60_000,
      ),

      observationMaxTextLength: boundedInteger(
        options.observationMaxTextLength ?? 20_000,

        'observationMaxTextLength',

        100_000,
      ),

      observationMaxControls: boundedInteger(
        options.observationMaxControls ?? 200,

        'observationMaxControls',

        2_000,
      ),

      modelFormatRetries: boundedNonnegativeInteger(
        options.modelFormatRetries ?? DEFAULT_DISCOVERY_MODEL_FORMAT_RETRIES,

        'modelFormatRetries',

        3,
      ),
    };

    this.createId = options.createId ?? randomUUID;

    this.now = options.now ?? (() => new Date());
  }

  async run(input: unknown, runOptions: DiscoveryRunOptions = {}): Promise<DiscoveryResult> {
    const request = parseDiscoveryRequest(input);

    const requestedConfig = resolveDiscoveryRunConfig(request);

    const runId = runOptions.runId ?? this.createId();

    const startedAt = this.now();

    const maxSteps = Math.min(requestedConfig.maxSteps, this.options.maxSteps);

    const state = createDiscoveryRunState({
      runId,

      request,

      config: { ...requestedConfig, maxSteps },

      startedAt: startedAt.toISOString(),

      deadlineAt: new Date(startedAt.getTime() + requestedConfig.timeoutMs).toISOString(),
    });

    const memory: WorkingMemory = {
      recentAction: null,

      recentCondition: null,

      recentError: null,

      history: [],
    };

    const context = await this.dependencies.coordinator.start({
      runId,

      mode: 'DISCOVERY',

      timeoutMs: requestedConfig.timeoutMs,

      ...(runOptions.headed === undefined ? {} : { headed: runOptions.headed }),

      ...(runOptions.evidenceRoot === undefined ? {} : { evidenceRoot: runOptions.evidenceRoot }),

      metadata: {
        application: request.target.application,

        goal: request.goal,

        maxSteps,
      },
    });

    try {
      await recordDiscoveryEvidenceEvent(context.evidenceRecorder, {
        name: 'discovery.started',

        step: 0,

        application: request.target.application,

        maxSteps,

        timeoutMs: requestedConfig.timeoutMs,
      });

      const entryResult = await this.ensureEntry(context, state, runOptions.signal);

      if (entryResult !== null) return entryResult;

      while (true) {
        const budgetStop = evaluateDiscoveryLoopBudget({
          step: state.step,

          maxSteps: state.config.maxSteps,

          nowMs: this.now().getTime(),

          deadlineAt: state.deadlineAt,

          aborted: runOptions.signal?.aborted === true,
        });

        if (budgetStop !== null) {
          return this.finishFailure(context, state, {
            code: budgetStop === 'max_steps' ? 'MAX_STEPS_EXCEEDED' : 'RUN_TIMEOUT',

            message:
              budgetStop === 'cancelled'
                ? 'Discovery was cancelled'
                : budgetStop === 'max_steps'
                  ? 'Discovery exhausted its maximum step budget'
                  : 'Discovery exceeded its runtime limit',

            expected: 'active discovery budget',

            observed: budgetStop,
          });
        }

        state.step += 1;

        const observed = await this.observe(context, state, runOptions.signal);

        if (observed.status === 'failure') {
          return this.finishFailure(context, state, mapSurfaceFailure(observed.error));
        }

        const agentObservation = projectObservationForAgent({
          goal: request.goal,

          step: state.step,

          observation: observed.observation,

          extractedValues: state.extractedValues,

          recentAction: memory.recentAction,

          recentCondition: memory.recentCondition,

          recentError: memory.recentError,
        });

        const observationEvidenceRefs = await this.captureObservationEvidence(
          context,

          state,

          memory,

          runOptions,
        );

        await context.evidenceRecorder.recordEvent({
          step: state.step,

          eventType: 'observation',

          result: agentObservation,

          evidenceRefs: observationEvidenceRefs,
        });

        await recordDiscoveryTrace(context.evidenceRecorder, {
          kind: 'observation',

          step: state.step,

          observationId: agentObservation.observationId,

          location: agentObservation.location,

          summary: agentObservation.visibleTextSummary,

          loading: agentObservation.loading,

          controlCount: agentObservation.controls.length,

          dialogCount: agentObservation.dialogs.length,

          evidenceRefs: observationEvidenceRefs,
        });

        await recordDiscoveryEvidenceEvent(context.evidenceRecorder, {
          name: 'observation.captured',

          step: state.step,

          observationId: agentObservation.observationId,

          loading: agentObservation.loading,

          controlCount: agentObservation.controls.length,

          dialogCount: agentObservation.dialogs.length,

          evidenceRefs: observationEvidenceRefs,
        });

        const applicationState = detectDiscoveryApplicationState(agentObservation);

        if (applicationState.kind === 'permission_denied') {
          return this.finishBusinessOutcome(context, state, applicationState.message);
        }

        if (applicationState.kind === 'session_expired') {
          return this.finishFailure(context, state, {
            code: 'SESSION_EXPIRED_UNRECOVERABLE',

            message: applicationState.message,

            expected: 'an active application session',

            observed: 'SESSION_EXPIRED',
          });
        }

        if (applicationState.kind === 'application_error') {
          return this.finishFailure(context, state, {
            code: 'APPLICATION_ERROR',

            message: applicationState.message,

            expected: 'an available application',

            observed: 'APPLICATION_ERROR',
          });
        }

        if (applicationState.kind === 'unsafe_dialog') {
          const dialogTitle =
            applicationState.dialog.kind === 'surface'
              ? applicationState.dialog.title
              : applicationState.dialog.message;

          return this.escalate(
            context,

            state,

            createDiscoveryIntervention(
              {
                source: 'unsafe_dialog',

                goal: request.goal,

                step: state.step,

                observationId: agentObservation.observationId,

                location: locationOf(agentObservation),

                dialogKind: applicationState.dialog.kind,

                dialogTitle,
              },

              { createId: this.createId },
            ),
          );
        }

        if (applicationState.kind === 'loading') {
          const loadingDecision = {
            kind: 'wait' as const,

            condition: { kind: 'loadingComplete' as const },

            reason: 'Wait for the current application load to finish',
          };

          const timeoutMs = this.remainingTimeout(state);

          const result = await new ConditionEvaluator(context.surface).evaluate(
            { conditionId: this.createId(), condition: loadingDecision.condition },

            {
              timeoutMs,

              pollIntervalMs: Math.min(this.options.conditionPollIntervalMs, timeoutMs),

              ...(runOptions.signal === undefined ? {} : { signal: runOptions.signal }),
            },
          );

          await context.evidenceRecorder.recordEvent({
            step: state.step,

            eventType: 'condition',

            action: loadingDecision,

            result,

            evidenceRefs: result.evidenceRefs,
          });

          await recordDiscoveryTrace(context.evidenceRecorder, {
            kind: 'condition_result',

            step: state.step,

            conditionKind: 'loadingComplete',

            status: result.status,

            observed: result.observed,

            evidenceRefs: result.evidenceRefs,
          });

          if (result.status === 'error') {
            return this.finishFailure(context, state, mapSurfaceFailure(result.error));
          }

          if (result.status === 'not_met') {
            return this.finishFailure(context, state, {
              code: 'RUN_TIMEOUT',

              message: 'Application did not finish loading within the discovery budget',

              expected: 'loading complete',

              observed: result.observed,
            });
          }

          memory.recentAction = null;

          memory.recentCondition = {
            status: 'passed',

            conditionKind: 'loadingComplete',

            summary: 'Application finished loading',
          };

          memory.recentError = null;

          appendHistory(memory, {
            step: state.step,

            decisionKind: 'wait',

            outcome: 'success',

            summary: 'System waited for application loading to complete',
          });

          appendDiscoveryStep(state, {
            step: state.step,

            observationId: agentObservation.observationId,

            observationFingerprint: createDiscoveryObservationFingerprint(agentObservation),

            decision: loadingDecision,

            outcome: 'action_succeeded',

            result: result.observed,
          });

          continue;
        }

        const currentFingerprint = createDiscoveryObservationFingerprint(agentObservation);

        recordDiscoveryObservationFingerprint(state, currentFingerprint);

        if (state.repeatedStateCount >= this.options.maxRepeatedStates) {
          await recordDiscoveryEvidenceEvent(context.evidenceRecorder, {
            name: 'stuck.detected',

            step: state.step,

            repeatedStateCount: state.repeatedStateCount,

            threshold: this.options.maxRepeatedStates,
          });

          return this.escalate(
            context,

            state,

            createDiscoveryIntervention(
              {
                source: 'repeated_state',

                goal: request.goal,

                step: state.step,

                observationId: agentObservation.observationId,

                location: locationOf(agentObservation),

                repeatedStateCount: state.repeatedStateCount,

                threshold: this.options.maxRepeatedStates,
              },

              { createId: this.createId },
            ),
          );
        }

        let decision: DiscoveryDecision;

        let validationAttempts: number;

        try {
          const validated = await requestValidatedDiscoveryDecision({
            model: this.dependencies.model,

            modelInput: createDiscoveryModelInput({
              observation: agentObservation,

              history: memory.history,
            }),

            maxFormatRetries: this.options.modelFormatRetries,

            onRequest: (attempt) =>
              recordDiscoveryEvidenceEvent(context.evidenceRecorder, {
                name: 'model.decision.requested',

                step: state.step,

                observationId: agentObservation.observationId,

                historyCount: memory.history.length,

                attempt,
              }),

            onInvalid: (invalid) =>
              recordDiscoveryEvidenceEvent(context.evidenceRecorder, {
                name: 'model.decision.invalid',

                step: state.step,

                attempt: invalid.attempt,

                issues: [...invalid.issues],
              }),
          });

          decision = validated.decision;

          validationAttempts = validated.attempts;
        } catch (error) {
          if (error instanceof DiscoveryDecisionValidationError) {
            return this.finishFailure(context, state, {
              code: 'MODEL_DECISION_VALIDATION_FAILED',

              message: error.message,

              expected: 'one valid DiscoveryDecision',

              observed: {
                attempts: error.attempts,

                issues: [...error.issues],
              },
            });
          }

          if (error instanceof DiscoveryModelRequestError) {
            return this.finishFailure(context, state, {
              code: 'MODEL_REQUEST_FAILED',

              message: error.message,

              expected: 'a successful discovery model response',

              observed: 'MODEL_REQUEST_FAILED',
            });
          }

          throw error;
        }

        await context.evidenceRecorder.recordEvent({
          step: state.step,

          eventType: 'model_decision',

          action: decision,

          result: { accepted: true, validationAttempts },
        });

        await recordDiscoveryTrace(context.evidenceRecorder, {
          kind: 'model_decision',

          step: state.step,

          decision,

          rationale: discoveryDecisionRationale(decision),
        });

        await recordDiscoveryEvidenceEvent(context.evidenceRecorder, {
          name: 'model.decision.received',

          step: state.step,

          decisionKind: decision.kind,

          attempts: validationAttempts,
        });

        if (decision.kind === 'complete') {
          const verification = verifyDiscoveryGoalCompletion({
            completion: decision,

            evidence: state,

            finalObservation: agentObservation,
          });

          if (verification.status === 'verified') {
            appendDiscoveryStep(state, {
              step: state.step,

              observationId: agentObservation.observationId,

              observationFingerprint: currentFingerprint,

              decision,

              outcome: 'completed',

              result: verification.outputs,
            });

            return this.finishSuccess(context, state, verification.outputs);
          }

          memory.recentAction = null;

          memory.recentCondition = null;

          memory.recentError = {
            code: 'UNSUPPORTED_COMPLETION',

            message: verification.issues.map((issue) => issue.message).join('; '),

            recoverable: true,
          };

          appendHistory(memory, {
            step: state.step,

            decisionKind: 'complete',

            outcome: 'failure',

            summary: 'Completion rejected because matching surface-read evidence was unavailable',
          });

          appendDiscoveryStep(state, {
            step: state.step,

            observationId: agentObservation.observationId,

            observationFingerprint: currentFingerprint,

            decision,

            outcome: 'completion_rejected',

            result: verification.issues.map((issue) => ({ ...issue })),
          });

          await context.evidenceRecorder.recordEvent({
            step: state.step,

            eventType: 'model_decision',

            action: decision,

            result: { accepted: false, issues: verification.issues },
          });

          continue;
        }

        if (decision.kind === 'escalate') {
          return this.escalate(
            context,

            state,

            createDiscoveryIntervention(
              {
                source: 'model',

                goal: request.goal,

                step: state.step,

                observationId: agentObservation.observationId,

                location: locationOf(agentObservation),

                decision,
              },

              { createId: this.createId },
            ),
          );
        }

        const terminal = await this.execute(
          context,

          state,

          memory,

          agentObservation,

          decision,

          runOptions.signal,
        );

        if (terminal !== null) return terminal;
      }
    } catch {
      await recordDiscoveryEvidenceEvent(context.evidenceRecorder, {
        name: 'discovery.failed',

        step: state.step,

        errorCode: 'APPLICATION_ERROR',
      }).catch(() => undefined);

      const summary = await this.dependencies.coordinator.fail({
        code: 'APPLICATION_ERROR',

        phase: 'discovery_loop',
      });

      return withDiscoverySteps(
        parseRuntimeResult({
          runId: summary.runId,

          startedAt: summary.startedAt,

          finishedAt: summary.finishedAt,

          durationMs: summary.durationMs,

          evidenceRefs: summary.evidenceRefs,

          sessionId: context.sessionManager.sessionId,

          recoverableConditions: [],

          status: 'failure',

          error: {
            code: 'APPLICATION_ERROR',

            message: 'Discovery engine failed unexpectedly',

            stepId: state.step === 0 ? null : String(state.step),

            expected: 'a valid bounded discovery transition',

            observed: 'unexpected internal failure',

            details: { phase: 'discovery_loop' },
          },
        }),

        state.step,
      );
    }
  }

  private async ensureEntry(
    context: DiscoveryContext,

    state: DiscoveryRunState,

    signal: AbortSignal | undefined,
  ): Promise<DiscoveryResult | null> {
    const observed = await this.observe(context, state, signal);

    if (observed.status === 'failure') {
      return this.finishFailure(context, state, mapSurfaceFailure(observed.error));
    }

    if (isAtEntry(observed.observation, state.request.target.entryUrl)) return null;

    const policy = context.policyEngine.evaluate({
      url: state.request.target.entryUrl,

      action: { kind: 'navigate' },
    });

    await context.evidenceRecorder.recordEvent({
      step: 0,

      eventType: 'policy_decision',

      action: { kind: 'navigate', destination: state.request.target.entryUrl },

      policyDecision: policy,
    });

    await recordDiscoveryTrace(context.evidenceRecorder, {
      kind: 'policy_decision',

      step: 0,

      actionKind: 'navigate',

      systemRiskLevel: 'READ_ONLY',

      policyDecision: policy,
    });

    await recordDiscoveryEvidenceEvent(context.evidenceRecorder, {
      name: 'policy.evaluated',

      step: 0,

      actionKind: 'navigate',

      riskLevel: 'READ_ONLY',

      decision: policy.decision,
    });

    if (policy.decision === 'DENY') {
      return this.finishFailure(context, state, {
        code: 'POLICY_DENIED',

        message: policy.reason,

        expected: 'policy-approved entry navigation',

        observed: 'policy denial',
      });
    }

    if (policy.decision === 'REQUIRE_HUMAN') {
      return this.escalate(
        context,

        state,

        createDiscoveryIntervention(
          {
            source: 'policy',

            goal: state.request.goal,

            step: 0,

            observationId: observed.observation.observationId,

            location: state.request.target.entryUrl,

            policyDecision: policy,

            actionKind: 'navigate',
          },

          { createId: this.createId },
        ),
      );
    }

    const actionId = this.createId();

    await recordDiscoveryEvidenceEvent(context.evidenceRecorder, {
      name: 'action.started',

      step: 0,

      actionId,

      actionKind: 'navigate',
    });

    assertDiscoveryActionOwnership(context);

    const result = await context.surface.perform(
      {
        actionId,

        action: { kind: 'navigate', destination: state.request.target.entryUrl },
      },

      this.operationOptions(state, signal),
    );

    await context.evidenceRecorder.recordEvent({
      step: 0,

      eventType: 'action',

      action: { kind: 'navigate', destination: state.request.target.entryUrl },

      result,

      evidenceRefs: result.evidenceRefs,
    });

    await recordDiscoveryEvidenceEvent(context.evidenceRecorder, {
      name: result.status === 'success' ? 'action.completed' : 'action.failed',

      step: 0,

      actionId,

      actionKind: 'navigate',

      ...(result.status === 'failure' ? { errorCode: result.error.code } : {}),

      evidenceRefs: result.evidenceRefs,
    });

    await recordDiscoveryTrace(context.evidenceRecorder, {
      kind: 'action_result',

      step: 0,

      actionKind: 'navigate',

      status: result.status,

      errorCode: result.status === 'failure' ? result.error.code : null,

      extractedValues: {},

      evidenceRefs: result.evidenceRefs,
    });

    return result.status === 'failure'
      ? this.finishFailure(context, state, mapSurfaceFailure(result.error))
      : null;
  }

  private async execute(
    context: DiscoveryContext,

    state: DiscoveryRunState,

    memory: WorkingMemory,

    observation: AgentObservation,

    decision: NonTerminalDecision,

    signal: AbortSignal | undefined,
  ): Promise<DiscoveryResult | null> {
    const evaluation = evaluateDiscoveryActionPolicy({
      policyEngine: context.policyEngine,

      observation,

      decision,
    });

    const { actionKind, decision: policy } = evaluation;

    await context.evidenceRecorder.recordEvent({
      step: state.step,

      eventType: 'policy_decision',

      action: decision,

      policyDecision: policy,
    });

    await recordDiscoveryTrace(context.evidenceRecorder, {
      kind: 'policy_decision',

      step: state.step,

      actionKind,

      systemRiskLevel: evaluation.risk.riskLevel,

      policyDecision: policy,
    });

    await recordDiscoveryEvidenceEvent(context.evidenceRecorder, {
      name: 'policy.evaluated',

      step: state.step,

      actionKind,

      riskLevel: evaluation.risk.riskLevel,

      decision: policy.decision,
    });

    if (policy.decision === 'DENY') {
      return this.finishFailure(context, state, {
        code: 'POLICY_DENIED',

        message: policy.reason,

        expected: 'an action allowed by deterministic policy',

        observed: decision.kind,
      });
    }

    if (policy.decision === 'REQUIRE_HUMAN') {
      return this.escalate(
        context,

        state,

        createDiscoveryIntervention(
          {
            source: 'policy',

            goal: state.request.goal,

            step: state.step,

            observationId: observation.observationId,

            location: locationOf(observation),

            policyDecision: policy,

            actionKind,
          },

          { createId: this.createId },
        ),
      );
    }

    if (decision.kind === 'wait') {
      const timeoutMs = this.remainingTimeout(state);

      const result = await new ConditionEvaluator(context.surface).evaluate(
        { conditionId: this.createId(), condition: decision.condition },

        {
          timeoutMs,

          pollIntervalMs: Math.min(this.options.conditionPollIntervalMs, timeoutMs),

          ...(signal === undefined ? {} : { signal }),
        },
      );

      await context.evidenceRecorder.recordEvent({
        step: state.step,

        eventType: 'condition',

        action: decision,

        result,

        evidenceRefs: result.evidenceRefs,
      });

      await recordDiscoveryTrace(context.evidenceRecorder, {
        kind: 'condition_result',

        step: state.step,

        conditionKind: decision.condition.kind,

        status: result.status,

        observed: result.observed,

        evidenceRefs: result.evidenceRefs,
      });

      memory.recentAction = null;

      memory.recentCondition = {
        status: result.status,

        conditionKind: decision.condition.kind,

        summary: result.passed ? 'Condition passed' : 'Condition was not satisfied',
      };

      memory.recentError =
        result.status === 'error'
          ? { code: result.error.code, message: result.error.message, recoverable: true }
          : null;

      appendHistory(memory, {
        step: state.step,

        decisionKind: 'wait',

        outcome:
          result.status === 'passed'
            ? 'success'
            : result.status === 'not_met'
              ? 'not_met'
              : 'failure',

        summary: memory.recentCondition.summary,
      });

      appendDiscoveryStep(state, {
        step: state.step,

        observationId: observation.observationId,

        observationFingerprint: createDiscoveryObservationFingerprint(observation),

        decision,

        outcome: result.status === 'passed' ? 'action_succeeded' : 'action_failed',

        result: result.observed,
      });

      return null;
    }

    const targetSpec = getDiscoveryDecisionTarget(decision);

    let target: ResolvedTarget | null = null;

    if (targetSpec !== null) {
      const resolution = await new TargetResolver(context.surface).resolve(
        { observationId: observation.observationId, target: targetSpec },

        this.operationOptions(state, signal),
      );

      await recordDiscoveryTrace(context.evidenceRecorder, {
        kind: 'target_resolution',

        step: state.step,

        targetDescription: targetSpec.description,

        status: resolution.status,

        attempts: resolution.attempts,

        errorCode: resolution.status === 'failure' ? resolution.error.code : null,
      });

      await recordDiscoveryEvidenceEvent(context.evidenceRecorder, {
        name: 'target.resolved',

        step: state.step,

        status: resolution.status,

        attemptCount: resolution.attempts.length,

        errorCode: resolution.status === 'failure' ? resolution.error.code : null,
      });

      if (resolution.status === 'failure') {
        if (resolution.error.code === 'TARGET_AMBIGUOUS') {
          return this.escalate(
            context,

            state,

            createDiscoveryIntervention(
              {
                source: 'unsafe_ambiguity',

                goal: state.request.goal,

                step: state.step,

                observationId: observation.observationId,

                location: locationOf(observation),

                targetDescription: targetSpec.description,

                resolutionAttempts: Math.max(1, resolution.attempts.length),
              },

              { createId: this.createId },
            ),
          );
        }

        if (isHardDiscoveryActionFailure(resolution.error)) {
          return this.finishFailure(context, state, mapSurfaceFailure(resolution.error));
        }

        this.recordFailure(state, memory, observation, decision, resolution.error);

        await context.evidenceRecorder.recordEvent({
          step: state.step,

          eventType: 'action',

          action: decision,

          target: targetSpec,

          result: resolution,
        });

        return null;
      }

      target = resolution.target;
    }

    const actionId = this.createId();

    await recordDiscoveryEvidenceEvent(context.evidenceRecorder, {
      name: 'action.started',

      step: state.step,

      actionId,

      actionKind: decision.kind,
    });

    assertDiscoveryActionOwnership(context);

    const result = await context.surface.perform(
      {
        actionId,

        action: translateDiscoveryDecision({
          decision,

          resolvedTarget: target,
        }),
      },

      this.operationOptions(state, signal),
    );

    await context.evidenceRecorder.recordEvent({
      step: state.step,

      eventType: 'action',

      action: decision,

      target: targetSpec,

      result,

      evidenceRefs: result.evidenceRefs,
    });

    if (result.status === 'failure') {
      await recordDiscoveryEvidenceEvent(context.evidenceRecorder, {
        name: 'action.failed',

        step: state.step,

        actionId,

        actionKind: decision.kind,

        errorCode: result.error.code,

        evidenceRefs: result.evidenceRefs,
      });

      await recordDiscoveryTrace(context.evidenceRecorder, {
        kind: 'action_result',

        step: state.step,

        actionKind: decision.kind,

        status: 'failure',

        errorCode: result.error.code,

        extractedValues: state.extractedValues,

        evidenceRefs: result.evidenceRefs,
      });
    }

    if (result.status === 'failure' && isHardDiscoveryActionFailure(result.error)) {
      return this.finishFailure(context, state, mapSurfaceFailure(result.error));
    }

    this.applyResult(state, memory, observation, decision, result);

    if (result.status === 'success') {
      await recordDiscoveryEvidenceEvent(context.evidenceRecorder, {
        name: 'action.completed',

        step: state.step,

        actionId,

        actionKind: decision.kind,

        evidenceRefs: result.evidenceRefs,
      });

      if (decision.kind === 'read' && Object.hasOwn(state.extractedValues, decision.saveAs)) {
        await recordDiscoveryEvidenceEvent(context.evidenceRecorder, {
          name: 'value.extracted',

          step: state.step,

          outputName: decision.saveAs,

          source: 'surface_read',

          evidenceRefs: result.evidenceRefs,
        });
      }

      await recordDiscoveryTrace(context.evidenceRecorder, {
        kind: 'action_result',

        step: state.step,

        actionKind: decision.kind,

        status: 'success',

        errorCode: null,

        extractedValues: state.extractedValues,

        evidenceRefs: result.evidenceRefs,
      });
    }

    return null;
  }

  private applyResult(
    state: DiscoveryRunState,

    memory: WorkingMemory,

    observation: AgentObservation,

    decision: TranslatableDiscoveryDecision,

    result: ActionResult,
  ): void {
    if (result.status === 'failure') {
      this.recordFailure(state, memory, observation, decision, result.error);

      return;
    }

    let extraction: ReturnType<typeof extractDiscoveryRead> | null = null;

    if (decision.kind === 'read') {
      extraction = extractDiscoveryRead({
        decision,

        result,

        step: state.step,

        observationId: observation.observationId,
      });

      if (extraction.status === 'rejected') {
        this.recordFailure(state, memory, observation, decision, extraction.error);

        return;
      }
    }

    const summary = actionSummary(decision);

    const output: JsonValue =
      result.output.kind === 'read' ? result.output.value : { kind: 'none' };

    memory.recentAction = {
      status: 'success',

      actionKind: decision.kind,

      summary,

      output,
    };

    memory.recentCondition = null;

    memory.recentError = null;

    let outcome: DiscoveryStepRecord['outcome'] = 'action_succeeded';

    if (extraction?.status === 'extracted') {
      retainDiscoveryExtraction(state, extraction.record);

      outcome = 'value_extracted';
    }

    appendHistory(memory, {
      step: state.step,

      decisionKind: decision.kind,

      outcome: 'success',

      summary,
    });

    appendDiscoveryStep(state, {
      step: state.step,

      observationId: observation.observationId,

      observationFingerprint: createDiscoveryObservationFingerprint(observation),

      decision,

      outcome,

      result: output,
    });
  }

  private recordFailure(
    state: DiscoveryRunState,

    memory: WorkingMemory,

    observation: AgentObservation,

    decision: TranslatableDiscoveryDecision,

    error: SurfaceFailure,
  ): void {
    const summary = `${actionSummary(decision)} failed: ${error.message}`;

    memory.recentAction = {
      status: 'failure',

      actionKind: decision.kind,

      summary,

      errorCode: error.code,

      recoverable: true,
    };

    memory.recentCondition = null;

    memory.recentError = {
      code: error.code,

      message: error.message,

      recoverable: true,
    };

    appendHistory(memory, {
      step: state.step,

      decisionKind: decision.kind,

      outcome: 'failure',

      summary,
    });

    appendDiscoveryStep(state, {
      step: state.step,

      observationId: observation.observationId,

      observationFingerprint: createDiscoveryObservationFingerprint(observation),

      decision,

      outcome: 'action_failed',

      result: {
        code: error.code,

        expected: error.expected,

        observed: error.observed,
      },
    });
  }

  private observe(
    context: DiscoveryContext,

    state: DiscoveryRunState,

    signal: AbortSignal | undefined,
  ) {
    return context.surface.observe({
      ...this.operationOptions(state, signal),

      maxTextLength: this.options.observationMaxTextLength,

      maxControls: this.options.observationMaxControls,
    });
  }

  private async captureObservationEvidence(
    context: DiscoveryContext,

    state: DiscoveryRunState,

    memory: WorkingMemory,

    runOptions: DiscoveryRunOptions,
  ): Promise<readonly EvidenceReference[]> {
    const plan = planDiscoveryObservationScreenshot({
      evidenceMode: runOptions.screenshotEvidence ?? 'none',

      step: state.step,

      ...(memory.recentAction === null
        ? {}
        : {
            recentActionKind: memory.recentAction.actionKind,
          }),
    });

    if (plan === null) return [];

    const captured = await context.surface.captureEvidence(
      {
        kind: 'screenshot',

        extent: plan.extent,
      },

      this.operationOptions(state, runOptions.signal),
    );

    if (captured.status === 'failure') {
      await context.evidenceRecorder.recordEvent({
        step: state.step,

        eventType: 'evidence_captured',

        result: {
          kind: 'screenshot',

          status: 'failure',

          purpose: plan.purpose,

          errorCode: captured.error.code,
        },
      });

      return [];
    }

    if (captured.evidence.kind !== 'screenshot') {
      return [];
    }

    const reference = await context.evidenceRecorder.captureScreenshot({
      step: state.step,

      bytes: captured.evidence.bytes,

      capturedAt: captured.evidence.capturedAt,

      dataHandling: plan.dataHandling,
    });

    await context.evidenceRecorder.recordEvent({
      step: state.step,

      eventType: 'evidence_captured',

      result: {
        kind: 'screenshot',

        status: 'success',

        purpose: plan.purpose,

        dataHandling: plan.dataHandling,
      },

      evidenceRefs: [reference],
    });

    return [reference];
  }

  private operationOptions(state: DiscoveryRunState, signal: AbortSignal | undefined) {
    return {
      timeoutMs: this.remainingTimeout(state),

      ...(signal === undefined ? {} : { signal }),
    };
  }

  private remainingTimeout(state: DiscoveryRunState): number {
    const remaining = Date.parse(state.deadlineAt) - this.now().getTime();

    return Math.max(1, Math.min(this.options.operationTimeoutMs, remaining));
  }

  private async finishSuccess(
    context: DiscoveryContext,

    state: DiscoveryRunState,

    outputs: Readonly<Record<string, JsonValue>>,
  ): Promise<DiscoveryResult> {
    await recordDiscoveryEvidenceEvent(context.evidenceRecorder, {
      name: 'discovery.completed',

      step: state.step,

      outputNames: Object.keys(outputs),
    });

    await recordDiscoveryTrace(context.evidenceRecorder, {
      kind: 'runtime_event',

      step: state.step,

      status: 'success',

      summary: 'Discovery goal completed with verified outputs',
    });

    const summary = await this.dependencies.coordinator.finish({
      status: 'success',

      result: { outputs },
    });

    return withDiscoverySteps(
      parseRuntimeResult({
        runId: summary.runId,

        startedAt: summary.startedAt,

        finishedAt: summary.finishedAt,

        durationMs: summary.durationMs,

        evidenceRefs: summary.evidenceRefs,

        sessionId: context.sessionManager.sessionId,

        recoverableConditions: [],

        status: 'success',

        outputs,
      }),

      state.step,
    );
  }

  private async finishBusinessOutcome(
    context: DiscoveryContext,

    state: DiscoveryRunState,

    message: string,
  ): Promise<DiscoveryResult> {
    const outcome = {
      code: 'PERMISSION_DENIED' as const,

      message,

      details: {
        phase: 'discovery_loop',

        step: state.step,
      },
    };

    await recordDiscoveryEvidenceEvent(context.evidenceRecorder, {
      name: 'discovery.business_outcome',

      step: state.step,

      outcomeCode: outcome.code,
    });

    await recordDiscoveryTrace(context.evidenceRecorder, {
      kind: 'runtime_event',

      step: state.step,

      status: 'business_outcome',

      summary: message,
    });

    const summary = await this.dependencies.coordinator.finish({
      status: 'business_outcome',

      result: { outcome },
    });

    return withDiscoverySteps(
      parseRuntimeResult({
        runId: summary.runId,

        startedAt: summary.startedAt,

        finishedAt: summary.finishedAt,

        durationMs: summary.durationMs,

        evidenceRefs: summary.evidenceRefs,

        sessionId: context.sessionManager.sessionId,

        recoverableConditions: [],

        status: 'business_outcome',

        outcome,
      }),

      state.step,
    );
  }

  private async escalate(
    context: DiscoveryContext,

    state: DiscoveryRunState,

    intervention: DiscoveryIntervention,
  ): Promise<DiscoveryResult> {
    await context.evidenceRecorder.recordEvent({
      step: state.step,

      eventType: 'intervention',

      result: intervention,
    });

    const source = intervention.context.source;

    await recordDiscoveryEvidenceEvent(
      context.evidenceRecorder,

      {
        name: 'discovery.escalated',

        step: state.step,

        reasonCode: intervention.code,

        source: typeof source === 'string' ? source : 'unknown',
      },
    );

    await recordDiscoveryTrace(
      context.evidenceRecorder,

      {
        kind: 'runtime_event',

        step: state.step,

        status: 'intervention_required',

        summary: intervention.message,
      },
    );

    if (this.dependencies.interventionController === undefined) {
      /*

     * Phase-2 compatibility fallback.

     *

     * We intentionally do NOT call coordinator.finish()

     * because intervention is non-terminal.

     */

      context.sessionManager.pause('DISCOVERY');
    } else {
      await this.dependencies.interventionController.createAndPause({
        context,

        id: intervention.interventionId,

        source: 'DISCOVERY',

        ...(typeof intervention.context.goal === 'string'
          ? { goal: intervention.context.goal }
          : {}),

        stepId: String(state.step),

        reasonCode: intervention.code,

        reason: intervention.message,

        observedState: buildInterventionObservedState(intervention),

        evidenceRefs: [context.evidenceRecorder.eventLogReference],
      });
    }

    const now = this.now();

    return withDiscoverySteps(
      parseRuntimeResult({
        runId: context.evidenceRecorder.runId,

        startedAt: context.evidenceRecorder.startedAt,

        finishedAt: now.toISOString(),

        durationMs: Math.max(
          0,

          now.getTime() - new Date(context.evidenceRecorder.startedAt).getTime(),
        ),

        evidenceRefs: [context.evidenceRecorder.eventLogReference],

        sessionId: context.sessionManager.sessionId,

        recoverableConditions: [],

        status: 'intervention_required',

        intervention: {
          ...intervention,

          /*

         * Phase 5 now preserves the live session,

         * so intervention is resumable.

         */

          resumable: true,
        },
      }),

      state.step,
    );
  }

  private async finishFailure(
    context: DiscoveryContext,

    state: DiscoveryRunState,

    failure: RuntimeFailureInput,
  ): Promise<DiscoveryResult> {
    const error = {
      ...failure,

      stepId: state.step === 0 ? null : String(state.step),

      details: { phase: 'discovery_loop', step: state.step },
    };

    await recordDiscoveryEvidenceEvent(context.evidenceRecorder, {
      name: 'discovery.failed',

      step: state.step,

      errorCode: failure.code,
    });

    await recordDiscoveryTrace(context.evidenceRecorder, {
      kind: 'runtime_event',

      step: state.step,

      status: 'failure',

      summary: failure.message,
    });

    const summary = await this.dependencies.coordinator.fail(error);

    return withDiscoverySteps(
      parseRuntimeResult({
        runId: summary.runId,

        startedAt: summary.startedAt,

        finishedAt: summary.finishedAt,

        durationMs: summary.durationMs,

        evidenceRefs: summary.evidenceRefs,

        sessionId: context.sessionManager.sessionId,

        recoverableConditions: [],

        status: 'failure',

        error,
      }),

      state.step,
    );
  }
}
