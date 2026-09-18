import { parseDiscoveryRunResult, parseDiscoveryTraceRecord } from '../discovery/index.js';

import type {
  DiscoveryExtractionRecord,
  DiscoveryRequest,
  DiscoveryRunResult,
  DiscoveryTraceRecord,
} from '../discovery/index.js';

import type { ConditionSpec } from '../conditions/index.js';

import { targetSpecSchema } from '../targeting/index.js';

import { ArtifactError } from './artifact-errors.js';

import {
  capabilityArtifactSchema,
  capabilityInputBindingSchema,
  capabilityOutputBindingSchema,
} from './artifact-schema.js';

import {
  extractSuccessfulDiscoveryPath,
  normalizeArtifactTargetSpec,
} from './artifact-normalizer.js';

import type { NormalizedDiscoveryAction } from './artifact-normalizer.js';

import { assertArtifactSafeToPersist } from './artifact-security.js';

import type { CapabilityArtifact, CapabilityStep } from './capability-artifact.js';

import { resolveCompileParameters, resolveStringInputReference } from './artifact-parameterizer.js';

import type {
  CompileParameterDefinitions,
  ResolvedCompileParameter,
} from './artifact-parameterizer.js';

export const ARTIFACT_COMPILER_VERSION = '1';

export const ARTIFACT_COMPILER_ELIGIBILITY_ERROR_CODES = [
  'FAILED_DISCOVERY',
  'BUSINESS_OUTCOME_DISCOVERY',
  'INTERVENTION_REQUIRED_DISCOVERY',
  'INCOMPLETE_DISCOVERY',
  'UNSUPPORTED_COMPLETION',
  'MISSING_REQUIRED_OUTPUT',
  'INVALID_TRACE',
  'UNSAFE_UNRESOLVED_ACTION',
] as const;

export type ArtifactCompilerEligibilityErrorCode =
  (typeof ARTIFACT_COMPILER_ELIGIBILITY_ERROR_CODES)[number];

export class ArtifactCompilerEligibilityError extends ArtifactError {
  readonly eligibilityCode: ArtifactCompilerEligibilityErrorCode;

  constructor(
    eligibilityCode: ArtifactCompilerEligibilityErrorCode,
    message: string,
    artifactCode:
      | 'ARTIFACT_SOURCE_INVALID'
      | 'ARTIFACT_SOURCE_NOT_SUCCESSFUL'
      | 'ARTIFACT_OUTPUT_BINDING_INVALID' = 'ARTIFACT_SOURCE_INVALID',
  ) {
    super(artifactCode, message);

    this.name = 'ArtifactCompilerEligibilityError';
    this.eligibilityCode = eligibilityCode;
  }
}

export interface DiscoveryArtifactSource {
  /**
   * Stable reference to the Phase 2 discovery run.
   */
  readonly runId: string;

  /**
   * Original validated discovery request.
   *
   * The compiler must not heuristically parse request.goal to discover
   * parameters. Explicit CompileOptions bindings own parameterization.
   */
  readonly request: DiscoveryRequest;

  /**
   * Final public result of the discovery run.
   */
  readonly result: DiscoveryRunResult;

  /**
   * Full ordered persisted Phase 2 discovery trace.
   *
   * This must not be DiscoveryRunState.recentSteps because that collection
   * is intentionally bounded working memory.
   */
  readonly trace: readonly DiscoveryTraceRecord[];

  /**
   * Successful read provenance retained by Phase 2.
   */
  readonly extractions: readonly DiscoveryExtractionRecord[];
}

export interface CompileOutputBinding {
  /**
   * Discovery read saveAs name.
   *
   * Example:
   * alexMorganSavingsBalance
   */
  readonly sourceOutputName: string;

  /**
   * Reusable artifact output name.
   *
   * Example:
   * savingsBalance
   */
  readonly outputName: string;
}

export interface CompileStepMetadata {
  readonly sourceStep: number;
  readonly id: string;
  readonly description: string;

  readonly preconditions?: readonly ConditionSpec[];
  readonly wait?: CapabilityStep['wait'];
  readonly postconditions?: readonly ConditionSpec[];
  readonly recovery?: CapabilityStep['recovery'];
}

export interface CompileOptions {
  /**
   * Caller-supplied timestamp keeps compilation deterministic.
   *
   * The compiler must not call Date.now(), new Date(), randomUUID(), etc.
   */
  readonly compiledAt: string;

  /**
   * Generalized source intent.
   *
   * Do not pass the discovery-specific raw goal when it contains concrete
   * member data.
   */
  readonly sourceGoal: string;

  readonly identity: CapabilityArtifact['identity'];
  readonly compatibility: CapabilityArtifact['compatibility'];

  readonly inputs: CapabilityArtifact['inputs'];
  readonly outputs: CapabilityArtifact['outputs'];

  readonly preconditions: CapabilityArtifact['preconditions'];
  readonly knownBusinessOutcomes?: CapabilityArtifact['knownBusinessOutcomes'];
  readonly successCondition: CapabilityArtifact['successCondition'];

  readonly risk: CapabilityArtifact['risk'];
  readonly metadata: CapabilityArtifact['metadata'];

  /**
   * Stable artifact step identities/descriptions supplied explicitly.
   *
   * No LLM or heuristic naming is allowed in the compiler.
   */
  readonly steps: readonly CompileStepMetadata[];

  /**
   * Explicit mapping from discovery read output names to artifact outputs.
   */
  readonly outputBindings: readonly CompileOutputBinding[];

  /**
   * Concrete values that must be gone after parameterization.
   *
   * These are forwarded to the Phase 3.21 persistence security scanner.
   */
  readonly forbiddenSourceLiterals?: readonly string[];

  readonly parameters?: CompileParameterDefinitions;
}

function eligibilityError(
  eligibilityCode: ArtifactCompilerEligibilityErrorCode,
  message: string,
  artifactCode:
    | 'ARTIFACT_SOURCE_INVALID'
    | 'ARTIFACT_SOURCE_NOT_SUCCESSFUL'
    | 'ARTIFACT_OUTPUT_BINDING_INVALID' = 'ARTIFACT_SOURCE_INVALID',
): never {
  throw new ArtifactCompilerEligibilityError(eligibilityCode, message, artifactCode);
}

function sourceInvalid(message: string): never {
  throw new ArtifactError('ARTIFACT_SOURCE_INVALID', message);
}

function outputBindingInvalid(message: string): never {
  throw new ArtifactError('ARTIFACT_OUTPUT_BINDING_INVALID', message);
}

function validateSourceContracts(source: DiscoveryArtifactSource): void {
  try {
    parseDiscoveryRunResult(source.result);
  } catch {
    eligibilityError(
      'INVALID_TRACE',
      'Discovery result does not satisfy the Phase 2 result contract',
    );
  }

  for (const record of source.trace) {
    try {
      parseDiscoveryTraceRecord(record);
    } catch {
      eligibilityError(
        'INVALID_TRACE',
        `Discovery trace contains an invalid record at step ${record.step}`,
      );
    }
  }

  if (source.result.runId !== source.runId) {
    eligibilityError(
      'INVALID_TRACE',
      'Discovery source run ID does not match the final discovery result',
    );
  }
}

function recordsAtStep(
  trace: readonly DiscoveryTraceRecord[],
  step: number,
): readonly DiscoveryTraceRecord[] {
  return trace.filter((record) => record.step === step);
}

function assertSuccessfulActionTraceIntegrity(source: DiscoveryArtifactSource): void {
  const actionableDecisions = source.trace.filter(
    (record): record is Extract<DiscoveryTraceRecord, { readonly kind: 'model_decision' }> =>
      record.kind === 'model_decision' &&
      record.decision.kind !== 'complete' &&
      record.decision.kind !== 'escalate',
  );

  for (const decisionRecord of actionableDecisions) {
    const records = recordsAtStep(source.trace, decisionRecord.step);

    const actionResult = records.find(
      (record): record is Extract<DiscoveryTraceRecord, { readonly kind: 'action_result' }> =>
        record.kind === 'action_result' && record.actionKind === decisionRecord.decision.kind,
    );

    if (actionResult === undefined || actionResult.status !== 'success') {
      continue;
    }

    const policyRecord = records.find(
      (record): record is Extract<DiscoveryTraceRecord, { readonly kind: 'policy_decision' }> =>
        record.kind === 'policy_decision' && record.actionKind === decisionRecord.decision.kind,
    );

    if (policyRecord === undefined || policyRecord.policyDecision.decision !== 'ALLOW') {
      eligibilityError(
        'INVALID_TRACE',
        `Successful action at discovery step ${decisionRecord.step} does not have a matching ALLOW policy decision`,
      );
    }

    const decision = decisionRecord.decision;

    const requiresTargetResolution =
      decision.kind === 'click' ||
      decision.kind === 'type' ||
      decision.kind === 'select' ||
      decision.kind === 'check' ||
      decision.kind === 'uncheck' ||
      decision.kind === 'read' ||
      (decision.kind === 'dismiss' && decision.dialog.kind === 'surface');

    if (!requiresTargetResolution) {
      continue;
    }

    const resolution = records.find(
      (record): record is Extract<DiscoveryTraceRecord, { readonly kind: 'target_resolution' }> =>
        record.kind === 'target_resolution',
    );

    if (resolution === undefined || resolution.status !== 'resolved') {
      eligibilityError(
        'UNSAFE_UNRESOLVED_ACTION',
        `Successful discovery action at step ${decisionRecord.step} lacks a successful target resolution`,
      );
    }
  }
}

function findOutputBinding(
  options: CompileOptions,
  sourceOutputName: string,
): CompileOutputBinding {
  const matches = options.outputBindings.filter(
    (binding) => binding.sourceOutputName === sourceOutputName,
  );

  const match = matches[0];

  if (matches.length !== 1 || match === undefined) {
    outputBindingInvalid(
      `Discovery output "${sourceOutputName}" requires exactly one explicit output binding`,
    );
  }

  return match;
}

function findStepMetadata(options: CompileOptions, sourceStep: number): CompileStepMetadata {
  const matches = options.steps.filter((step) => step.sourceStep === sourceStep);

  const match = matches[0];

  if (matches.length !== 1 || match === undefined) {
    sourceInvalid(`Discovery step ${sourceStep} requires exactly one compile step mapping`);
  }

  return match;
}

function compileTarget(target: unknown): CapabilityStep['target'] {
  const parsed = targetSpecSchema.parse(target);

  return normalizeArtifactTargetSpec(parsed);
}

function compileAction(
  source: DiscoveryArtifactSource,
  traceAction: NormalizedDiscoveryAction,
  options: CompileOptions,
  parameters: readonly ResolvedCompileParameter[],
): Pick<CapabilityStep, 'action' | 'target'> {
  const { decision, sourceStep: step } = traceAction;

  switch (decision.kind) {
    case 'click':
      return {
        action: {
          kind: 'click',
        },
        target: compileTarget(decision.target),
      };

    case 'type': {
      const inputRef = resolveStringInputReference(decision.text, parameters);

      return {
        action: {
          kind: 'type',
          value: capabilityInputBindingSchema.parse(inputRef),
          mode: decision.mode,
        },
        target: compileTarget(decision.target),
      };
    }

    case 'read': {
      const binding = findOutputBinding(options, decision.saveAs);

      const declaredOutput = options.outputs.find((output) => output.name === binding.outputName);

      if (declaredOutput === undefined) {
        outputBindingInvalid(
          `Output binding "${binding.outputName}" is not declared by the capability`,
        );
      }

      const extraction = source.extractions.find(
        (record) =>
          record.step === step &&
          record.outputName === decision.saveAs &&
          record.source === 'surface_read',
      );

      if (extraction === undefined) {
        outputBindingInvalid(
          `Discovery read "${decision.saveAs}" at step ${step} has no verified extraction record`,
        );
      }

      return {
        action: {
          kind: 'read',
          source: decision.source,
          saveAs: capabilityOutputBindingSchema.parse({
            kind: 'outputRef',
            name: binding.outputName,
          }),
        },
        target: compileTarget(decision.target),
      };
    }

    case 'select':
    case 'check':
    case 'uncheck':
    case 'navigate':
    case 'wait':
    case 'dismiss':
      return sourceInvalid(
        `Discovery action "${decision.kind}" is not yet supported by ArtifactCompiler`,
      );

    case 'complete':
    case 'escalate':
      return sourceInvalid(
        `Terminal discovery decision "${decision.kind}" cannot become an artifact step`,
      );
  }
}

function compileStep(
  source: DiscoveryArtifactSource,
  traceAction: NormalizedDiscoveryAction,
  options: CompileOptions,
  parameters: readonly ResolvedCompileParameter[],
): CapabilityStep {
  const metadata = findStepMetadata(options, traceAction.sourceStep);

  const compiled = compileAction(source, traceAction, options, parameters);

  return {
    id: metadata.id,
    description: metadata.description,
    action: compiled.action,
    ...(compiled.target === undefined
      ? {}
      : {
          target: compiled.target,
        }),
    ...(metadata.preconditions === undefined
      ? {}
      : {
          preconditions: [...metadata.preconditions],
        }),
    ...(metadata.wait === undefined
      ? {}
      : {
          wait: metadata.wait,
        }),
    ...(metadata.postconditions === undefined
      ? {}
      : {
          postconditions: [...metadata.postconditions],
        }),
    ...(metadata.recovery === undefined
      ? {}
      : {
          recovery: [...metadata.recovery],
        }),
    risk: traceAction.risk,
  };
}

function assertSourceEligible(source: DiscoveryArtifactSource, options: CompileOptions): void {
  validateSourceContracts(source);

  switch (source.result.status) {
    case 'failure':
      return eligibilityError(
        'FAILED_DISCOVERY',
        'Failed discovery runs cannot be compiled into reusable artifacts',
        'ARTIFACT_SOURCE_NOT_SUCCESSFUL',
      );

    case 'business_outcome':
      return eligibilityError(
        'BUSINESS_OUTCOME_DISCOVERY',
        'Discovery runs that ended in a business outcome cannot be compiled into reusable artifacts',
        'ARTIFACT_SOURCE_NOT_SUCCESSFUL',
      );

    case 'intervention_required':
      return eligibilityError(
        'INTERVENTION_REQUIRED_DISCOVERY',
        'Discovery runs requiring human intervention cannot be compiled into reusable artifacts',
        'ARTIFACT_SOURCE_NOT_SUCCESSFUL',
      );

    case 'success':
      break;
  }

  assertSuccessfulActionTraceIntegrity(source);

  const completionRecords = source.trace.filter(
    (record): record is Extract<DiscoveryTraceRecord, { readonly kind: 'model_decision' }> =>
      record.kind === 'model_decision' && record.decision.kind === 'complete',
  );

  if (completionRecords.length === 0) {
    eligibilityError(
      'INCOMPLETE_DISCOVERY',
      'Successful discovery source has no completion decision',
    );
  }

  if (completionRecords.length !== 1) {
    eligibilityError(
      'UNSUPPORTED_COMPLETION',
      'Discovery source must contain exactly one accepted completion decision',
    );
  }

  const completion = completionRecords[0];

  if (completion === undefined) {
    eligibilityError('INCOMPLETE_DISCOVERY', 'Discovery completion record is unavailable');
  }

  if (completion.decision.kind !== 'complete') {
    eligibilityError(
      'UNSUPPORTED_COMPLETION',
      'Discovery completion record is not a complete decision',
    );
  }

  const terminalSuccessEvents = source.trace.filter(
    (record): record is Extract<DiscoveryTraceRecord, { readonly kind: 'runtime_event' }> =>
      record.kind === 'runtime_event' && record.status === 'success',
  );

  if (terminalSuccessEvents.length !== 1) {
    eligibilityError(
      'INCOMPLETE_DISCOVERY',
      'Successful discovery source must contain exactly one terminal success event',
    );
  }

  for (const binding of options.outputBindings) {
    if (
      !Object.prototype.hasOwnProperty.call(completion.decision.outputs, binding.sourceOutputName)
    ) {
      eligibilityError(
        'MISSING_REQUIRED_OUTPUT',
        `Completion does not contain required discovery output "${binding.sourceOutputName}"`,
        'ARTIFACT_OUTPUT_BINDING_INVALID',
      );
    }

    if (!Object.prototype.hasOwnProperty.call(source.result.outputs, binding.sourceOutputName)) {
      eligibilityError(
        'MISSING_REQUIRED_OUTPUT',
        `Final discovery result does not contain required output "${binding.sourceOutputName}"`,
        'ARTIFACT_OUTPUT_BINDING_INVALID',
      );
    }

    const verifiedExtraction = source.extractions.find(
      (extraction) =>
        extraction.outputName === binding.sourceOutputName && extraction.source === 'surface_read',
    );

    if (verifiedExtraction === undefined) {
      eligibilityError(
        'MISSING_REQUIRED_OUTPUT',
        `Required output "${binding.sourceOutputName}" has no verified surface-read extraction`,
        'ARTIFACT_OUTPUT_BINDING_INVALID',
      );
    }
  }
}

function assertCompileMappingsConsumed(
  successfulActions: readonly NormalizedDiscoveryAction[],
  options: CompileOptions,
): void {
  const successfulSteps = new Set(successfulActions.map((action) => action.sourceStep));

  for (const metadata of options.steps) {
    if (!successfulSteps.has(metadata.sourceStep)) {
      sourceInvalid(
        `Compile step mapping references non-successful discovery step ${metadata.sourceStep}`,
      );
    }
  }
}

export class ArtifactCompiler {
  compile(source: DiscoveryArtifactSource, options: CompileOptions): CapabilityArtifact {
    assertSourceEligible(source, options);

    const parameters = resolveCompileParameters(source.request, options.inputs, options.parameters);

    const successfulPath = extractSuccessfulDiscoveryPath(source.trace);

    const successfulActions = successfulPath.actions;

    if (successfulActions.length === 0) {
      sourceInvalid('Successful discovery contains no reusable successful actions');
    }

    assertCompileMappingsConsumed(successfulActions, options);

    const steps = successfulActions.map((action) =>
      compileStep(source, action, options, parameters),
    );

    const candidate = {
      schemaVersion: '1.0',
      identity: options.identity,
      compatibility: options.compatibility,
      inputs: options.inputs,
      outputs: options.outputs,
      preconditions: options.preconditions,
      steps,
      ...(options.knownBusinessOutcomes === undefined
        ? {}
        : {
            knownBusinessOutcomes: options.knownBusinessOutcomes,
          }),
      successCondition: options.successCondition,
      risk: options.risk,
      provenance: {
        discoveryRunId: source.runId,
        compiledAt: options.compiledAt,
        compilerVersion: ARTIFACT_COMPILER_VERSION,
        sourceGoal: options.sourceGoal,
      },
      metadata: options.metadata,
    };

    /*
     * Parameterization must already have removed discovery-specific
     * invocation values before this point.
     */
    assertArtifactSafeToPersist(
      candidate,
      options.forbiddenSourceLiterals === undefined
        ? {}
        : {
            forbiddenLiterals: options.forbiddenSourceLiterals,
          },
    );

    return capabilityArtifactSchema.parse(candidate);
  }
}
