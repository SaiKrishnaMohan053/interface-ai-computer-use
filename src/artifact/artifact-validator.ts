import type {
  ArtifactSuccessCondition,
  CapabilityArtifact,
  CapabilityStep,
} from './capability-artifact.js';

import { ArtifactError } from './artifact-errors.js';

export class ArtifactSemanticValidationError extends ArtifactError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super('ARTIFACT_SEMANTIC_INVALID', message, details);

    this.name = 'ArtifactSemanticValidationError';
  }
}

function semanticInvalid(message: string, details?: Readonly<Record<string, unknown>>): never {
  throw new ArtifactSemanticValidationError(message, details);
}

function assertUniqueValues(values: readonly string[], kind: string): void {
  const seen = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      semanticInvalid(`Duplicate ${kind} "${value}"`, {
        kind,
        value,
      });
    }

    seen.add(value);
  }
}

function assertInputReferenceDeclared(
  inputName: string,
  declaredInputs: ReadonlySet<string>,
  stepId: string,
): void {
  if (!declaredInputs.has(inputName)) {
    semanticInvalid(`Step "${stepId}" references undeclared input "${inputName}"`, {
      stepId,
      inputName,
    });
  }
}

function validateStepInputReferences(
  step: CapabilityStep,
  declaredInputs: ReadonlySet<string>,
): void {
  switch (step.action.kind) {
    case 'type':
      assertInputReferenceDeclared(step.action.value.name, declaredInputs, step.id);
      return;

    case 'select': {
      const inputName =
        step.action.option.kind === 'label'
          ? step.action.option.label.name
          : step.action.option.value.name;

      assertInputReferenceDeclared(inputName, declaredInputs, step.id);

      return;
    }

    case 'click':
    case 'check':
    case 'uncheck':
    case 'navigate':
    case 'read':
    case 'wait':
    case 'dismiss':
      return;
  }
}

function assertOutputReferenceDeclared(
  outputName: string,
  declaredOutputs: ReadonlySet<string>,
  context: string,
): void {
  if (!declaredOutputs.has(outputName)) {
    semanticInvalid(`${context} references undeclared output "${outputName}"`, {
      context,
      outputName,
    });
  }
}

function validateStepOutputReferences(
  step: CapabilityStep,
  declaredOutputs: ReadonlySet<string>,
): void {
  if (step.action.kind !== 'read') {
    return;
  }

  assertOutputReferenceDeclared(step.action.saveAs.name, declaredOutputs, `Step "${step.id}"`);
}

function validateSuccessCondition(
  condition: ArtifactSuccessCondition,
  declaredOutputs: ReadonlySet<string>,
  path = 'successCondition',
): void {
  switch (condition.kind) {
    case 'surface':
      return;

    case 'outputPresent':
      assertOutputReferenceDeclared(condition.output.name, declaredOutputs, path);
      return;

    case 'all':
    case 'any':
      condition.conditions.forEach((nestedCondition, index) => {
        validateSuccessCondition(
          nestedCondition,
          declaredOutputs,
          `${path}.${condition.kind}[${index}]`,
        );
      });
      return;

    case 'not':
      validateSuccessCondition(condition.condition, declaredOutputs, `${path}.not`);
      return;
  }
}

function validateKnownBusinessOutcomes(artifact: CapabilityArtifact): void {
  const outcomes = artifact.knownBusinessOutcomes ?? [];

  assertUniqueValues(
    outcomes.map((outcome) => outcome.code),
    'known business outcome code',
  );

  /*
   * Detector shape and target structure
   * are already enforced by
   * conditionSpecSchema.
   *
   * There are currently no artifact
   * inputRef/outputRef bindings inside
   * ConditionSpec, so no additional
   * cross-reference resolution is
   * required here.
   */
}

function validateRecoveryRules(artifact: CapabilityArtifact): void {
  for (const step of artifact.steps) {
    const recovery = step.recovery ?? [];

    const seenConditions = new Set<string>();

    for (const rule of recovery) {
      if (seenConditions.has(rule.condition)) {
        semanticInvalid(
          `Step "${step.id}" contains multiple recovery rules for condition "${rule.condition}"`,
          {
            stepId: step.id,
            condition: rule.condition,
          },
        );
      }

      seenConditions.add(rule.condition);

      /*
       * Zod already guarantees:
       *
       * retry
       *   -> TRANSIENT_LOAD
       *
       * dismissKnownDialog
       *   -> KNOWN_INTERSTITIAL
       *
       * and validates bounded retry
       * waits. We intentionally avoid
       * duplicating those shape rules.
       */
    }
  }
}

const RISK_RANK = {
  READ_ONLY: 0,
  REVERSIBLE: 1,
  SENSITIVE_WRITE: 2,
  IRREVERSIBLE: 3,
} as const;

type RiskLevel = CapabilityStep['risk'];

function maxRisk(risks: readonly RiskLevel[]): RiskLevel {
  if (risks.length === 0) {
    semanticInvalid(
      'Capability must contain at least one reusable step before risk metadata can be validated',
    );
  }

  let maximum = risks[0];

  if (maximum === undefined) {
    semanticInvalid(
      'Capability must contain at least one reusable step before risk metadata can be validated',
    );
  }

  for (let index = 1; index < risks.length; index += 1) {
    const candidate = risks[index];

    if (candidate !== undefined && RISK_RANK[candidate] > RISK_RANK[maximum]) {
      maximum = candidate;
    }
  }

  return maximum;
}

function validateRiskMetadata(artifact: CapabilityArtifact): void {
  const actualMaxStepRisk = maxRisk(artifact.steps.map((step) => step.risk));

  if (artifact.risk.maxStepRisk !== actualMaxStepRisk) {
    semanticInvalid(
      `Artifact maxStepRisk "${artifact.risk.maxStepRisk}" does not match highest persisted step risk "${actualMaxStepRisk}"`,
      {
        declaredMaxStepRisk: artifact.risk.maxStepRisk,
        actualMaxStepRisk,
      },
    );
  }

  /*
   * summaryRisk is intentionally a
   * separate business-effect axis.
   *
   * Do not compare it numerically with
   * maxStepRisk. A READ_ONLY capability
   * may legitimately contain a
   * REVERSIBLE UI interaction such as
   * typing search criteria.
   *
   * runtimePolicyRequired === true is
   * already enforced structurally by
   * capabilityRiskMetadataSchema.
   */
}

function validateRequiredOutputs(artifact: CapabilityArtifact): void {
  const producedOutputs = new Set<string>();

  for (const step of artifact.steps) {
    if (step.action.kind === 'read') {
      producedOutputs.add(step.action.saveAs.name);
    }
  }

  for (const output of artifact.outputs) {
    if (output.required && !producedOutputs.has(output.name)) {
      semanticInvalid(
        `Required output "${output.name}" is not produced by any reusable artifact step`,
        {
          outputName: output.name,
        },
      );
    }
  }
}

function validateReusableSteps(artifact: CapabilityArtifact): void {
  if (artifact.steps.length === 0) {
    semanticInvalid('Capability artifact must contain at least one reusable step');
  }
}

function validateWaitPolicies(artifact: CapabilityArtifact): void {
  for (const step of artifact.steps) {
    if (step.action.kind === 'wait' && step.wait === undefined) {
      semanticInvalid(`Wait step "${step.id}" requires an explicit bounded wait policy`, {
        stepId: step.id,
        actionKind: step.action.kind,
      });
    }
  }
}

/**
 * Validates cross-field semantic
 * invariants after structural Zod
 * parsing.
 *
 * This validator deliberately does
 * not:
 *
 * - resolve UI targets,
 * - contact a browser,
 * - evaluate runtime policy,
 * - execute conditions,
 * - replay the capability.
 *
 * Those responsibilities belong to
 * later runtime phases.
 */
export function validateCapabilityArtifactSemantics(
  artifact: CapabilityArtifact,
): CapabilityArtifact {
  validateReusableSteps(artifact);

  assertUniqueValues(
    artifact.steps.map((step) => step.id),
    'step ID',
  );

  assertUniqueValues(
    artifact.inputs.map((input) => input.name),
    'input name',
  );

  assertUniqueValues(
    artifact.outputs.map((output) => output.name),
    'output name',
  );

  const declaredInputs = new Set(artifact.inputs.map((input) => input.name));

  const declaredOutputs = new Set(artifact.outputs.map((output) => output.name));

  for (const step of artifact.steps) {
    validateStepInputReferences(step, declaredInputs);

    validateStepOutputReferences(step, declaredOutputs);
  }

  validateSuccessCondition(artifact.successCondition, declaredOutputs);

  validateKnownBusinessOutcomes(artifact);

  validateRecoveryRules(artifact);

  validateWaitPolicies(artifact);

  validateRiskMetadata(artifact);

  validateRequiredOutputs(artifact);

  return artifact;
}
