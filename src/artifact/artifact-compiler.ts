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

import { normalizeArtifactTargetSpec } from './artifact-normalizer.js';

import { assertArtifactSafeToPersist } from './artifact-security.js';

import type { CapabilityArtifact, CapabilityStep } from './capability-artifact.js';

export const ARTIFACT_COMPILER_VERSION = '1';

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

export interface CompileInputBinding {
  /**
   * Discovery step containing the invocation-specific type action.
   */
  readonly sourceStep: number;

  /**
   * Capability input replacing the concrete discovery value.
   */
  readonly inputName: string;
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
   * Explicit replacement of concrete discovery type values.
   */
  readonly inputBindings: readonly CompileInputBinding[];

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
}

interface SuccessfulTraceAction {
  readonly step: number;
  readonly decision: Extract<DiscoveryTraceRecord, { readonly kind: 'model_decision' }>['decision'];

  readonly risk: Extract<
    DiscoveryTraceRecord,
    { readonly kind: 'policy_decision' }
  >['systemRiskLevel'];
}

function sourceInvalid(message: string): never {
  throw new ArtifactError('ARTIFACT_SOURCE_INVALID', message);
}

function parameterBindingInvalid(message: string): never {
  throw new ArtifactError('ARTIFACT_PARAMETER_BINDING_INVALID', message);
}

function outputBindingInvalid(message: string): never {
  throw new ArtifactError('ARTIFACT_OUTPUT_BINDING_INVALID', message);
}

function recordsAtStep(
  trace: readonly DiscoveryTraceRecord[],
  step: number,
): readonly DiscoveryTraceRecord[] {
  return trace.filter((record) => record.step === step);
}

function findSuccessfulTraceActions(source: DiscoveryArtifactSource): SuccessfulTraceAction[] {
  const decisionRecords = source.trace.filter(
    (record): record is Extract<DiscoveryTraceRecord, { readonly kind: 'model_decision' }> =>
      record.kind === 'model_decision',
  );

  const successful: SuccessfulTraceAction[] = [];

  for (const decisionRecord of decisionRecords) {
    const { decision, step } = decisionRecord;

    if (decision.kind === 'complete' || decision.kind === 'escalate') {
      continue;
    }

    const records = recordsAtStep(source.trace, step);

    const policyRecord = records.find(
      (record): record is Extract<DiscoveryTraceRecord, { readonly kind: 'policy_decision' }> =>
        record.kind === 'policy_decision' && record.actionKind === decision.kind,
    );

    if (policyRecord === undefined) {
      sourceInvalid(`Discovery step ${step} has no matching policy decision`);
    }

    if (policyRecord.policyDecision.decision !== 'ALLOW') {
      continue;
    }

    const actionResult = records.find(
      (record): record is Extract<DiscoveryTraceRecord, { readonly kind: 'action_result' }> =>
        record.kind === 'action_result' && record.actionKind === decision.kind,
    );

    if (actionResult === undefined) {
      sourceInvalid(`Discovery step ${step} has no matching action result`);
    }

    /*
     * Failed attempts are discovery evidence, not reusable artifact steps.
     */
    if (actionResult.status !== 'success') {
      continue;
    }

    successful.push({
      step,
      decision,
      risk: policyRecord.systemRiskLevel,
    });
  }

  successful.sort((left, right) => left.step - right.step);

  return successful;
}

function findInputBinding(options: CompileOptions, sourceStep: number): CompileInputBinding {
  const matches = options.inputBindings.filter((binding) => binding.sourceStep === sourceStep);

  const match = matches[0];

  if (matches.length !== 1 || match === undefined) {
    parameterBindingInvalid(
      `Discovery step ${sourceStep} requires exactly one explicit input binding`,
    );
  }

  return match;
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
  traceAction: SuccessfulTraceAction,
  options: CompileOptions,
): Pick<CapabilityStep, 'action' | 'target'> {
  const { decision, step } = traceAction;

  switch (decision.kind) {
    case 'click':
      return {
        action: {
          kind: 'click',
        },
        target: compileTarget(decision.target),
      };

    case 'type': {
      const binding = findInputBinding(options, step);

      const declaredInput = options.inputs.find((input) => input.name === binding.inputName);

      if (declaredInput === undefined) {
        parameterBindingInvalid(
          `Input binding "${binding.inputName}" is not declared by the capability`,
        );
      }

      return {
        action: {
          kind: 'type',
          value: capabilityInputBindingSchema.parse({
            kind: 'inputRef',
            name: binding.inputName,
          }),
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

    /*
     * 3.22 deliberately compiles only the action shapes exercised by the
     * primary verified capability. Other artifact actions already exist in
     * the schema, but compiler support must be added deliberately rather
     * than guessed.
     */
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
  traceAction: SuccessfulTraceAction,
  options: CompileOptions,
): CapabilityStep {
  const metadata = findStepMetadata(options, traceAction.step);

  const compiled = compileAction(source, traceAction, options);

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

function assertSourceEligible(source: DiscoveryArtifactSource): void {
  if (source.result.status !== 'success') {
    throw new ArtifactError(
      'ARTIFACT_SOURCE_NOT_SUCCESSFUL',
      `Artifact compilation requires a successful discovery result; received ${source.result.status}`,
    );
  }

  const completionRecords = source.trace.filter(
    (record): record is Extract<DiscoveryTraceRecord, { readonly kind: 'model_decision' }> =>
      record.kind === 'model_decision' && record.decision.kind === 'complete',
  );

  if (completionRecords.length !== 1) {
    sourceInvalid(
      'A successful discovery source must contain exactly one accepted completion decision',
    );
  }

  const terminalEvents = source.trace.filter(
    (record): record is Extract<DiscoveryTraceRecord, { readonly kind: 'runtime_event' }> =>
      record.kind === 'runtime_event',
  );

  const terminalSuccess = terminalEvents.some((record) => record.status === 'success');

  if (!terminalSuccess) {
    sourceInvalid('A successful discovery source must contain a successful runtime terminal event');
  }
}

function assertCompileMappingsConsumed(
  successfulActions: readonly SuccessfulTraceAction[],
  options: CompileOptions,
): void {
  const successfulSteps = new Set(successfulActions.map((action) => action.step));

  for (const metadata of options.steps) {
    if (!successfulSteps.has(metadata.sourceStep)) {
      sourceInvalid(
        `Compile step mapping references non-successful discovery step ${metadata.sourceStep}`,
      );
    }
  }

  for (const binding of options.inputBindings) {
    if (!successfulSteps.has(binding.sourceStep)) {
      parameterBindingInvalid(
        `Input binding references non-successful discovery step ${binding.sourceStep}`,
      );
    }
  }
}

export class ArtifactCompiler {
  compile(source: DiscoveryArtifactSource, options: CompileOptions): CapabilityArtifact {
    assertSourceEligible(source);

    const successfulActions = findSuccessfulTraceActions(source);

    if (successfulActions.length === 0) {
      sourceInvalid('Successful discovery contains no reusable successful actions');
    }

    assertCompileMappingsConsumed(successfulActions, options);

    const steps = successfulActions.map((action) => compileStep(source, action, options));

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
