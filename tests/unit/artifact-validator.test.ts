import { describe, expect, it } from 'vitest';

import {
  ArtifactCompiler,
  ArtifactSemanticValidationError,
  validateCapabilityArtifactSemantics,
  type CapabilityArtifact,
} from '../../src/artifact/index.js';

import {
  createCompileOptions,
  createCompilerSource,
} from '../helpers/artifact-compiler-fixture.js';

function validArtifact(): CapabilityArtifact {
  const compiler = new ArtifactCompiler();

  return compiler.compile(createCompilerSource(), createCompileOptions());
}

function expectSemanticFailure(artifact: CapabilityArtifact, expectedMessage: string): void {
  try {
    validateCapabilityArtifactSemantics(artifact);

    expect.fail('Expected semantic validation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(ArtifactSemanticValidationError);

    expect(error).toMatchObject({
      code: 'ARTIFACT_SEMANTIC_INVALID',
    });

    if (error instanceof ArtifactSemanticValidationError) {
      expect(error.message).toContain(expectedMessage);
    }
  }
}

describe('validateCapabilityArtifactSemantics', () => {
  it('accepts a valid compiler-produced artifact', () => {
    const artifact = validArtifact();

    expect(validateCapabilityArtifactSemantics(artifact)).toEqual(artifact);
  });

  it('rejects duplicate step IDs', () => {
    const artifact = validArtifact();

    const duplicate = artifact.steps[0];

    if (duplicate === undefined) {
      throw new Error('Fixture step missing');
    }

    const invalid: CapabilityArtifact = {
      ...artifact,
      steps: [
        ...artifact.steps,
        {
          ...duplicate,
        },
      ],
    };

    expectSemanticFailure(invalid, 'Duplicate step ID');
  });

  it('rejects duplicate input names', () => {
    const artifact = validArtifact();

    const input = artifact.inputs[0];

    if (input === undefined) {
      throw new Error('Fixture input missing');
    }

    const invalid: CapabilityArtifact = {
      ...artifact,
      inputs: [
        ...artifact.inputs,
        {
          ...input,
        },
      ],
    };

    expectSemanticFailure(invalid, 'Duplicate input name');
  });

  it('rejects duplicate output names', () => {
    const artifact = validArtifact();

    const output = artifact.outputs[0];

    if (output === undefined) {
      throw new Error('Fixture output missing');
    }

    const invalid: CapabilityArtifact = {
      ...artifact,
      outputs: [
        ...artifact.outputs,
        {
          ...output,
        },
      ],
    };

    expectSemanticFailure(invalid, 'Duplicate output name');
  });

  it('rejects an undeclared type inputRef', () => {
    const artifact = validArtifact();

    const firstStep = artifact.steps[0];

    if (firstStep === undefined) {
      throw new Error('Fixture step missing');
    }

    const invalid: CapabilityArtifact = {
      ...artifact,
      steps: [
        {
          ...firstStep,
          action: {
            kind: 'type',
            value: {
              kind: 'inputRef',
              name: 'missingInput',
            },
            mode: 'replace',
          },
        },
        ...artifact.steps.slice(1),
      ],
    };

    expectSemanticFailure(invalid, 'undeclared input "missingInput"');
  });

  it('rejects an undeclared select inputRef', () => {
    const artifact = validArtifact();

    const firstStep = artifact.steps[0];

    if (firstStep === undefined) {
      throw new Error('Fixture step missing');
    }

    const invalid: CapabilityArtifact = {
      ...artifact,
      steps: [
        {
          ...firstStep,
          action: {
            kind: 'select',
            option: {
              kind: 'label',
              label: {
                kind: 'inputRef',
                name: 'missingAccountType',
              },
            },
          },
        },
        ...artifact.steps.slice(1),
      ],
    };

    expectSemanticFailure(invalid, 'undeclared input "missingAccountType"');
  });

  it('rejects an undeclared read outputRef', () => {
    const artifact = validArtifact();

    const readIndex = artifact.steps.findIndex((step) => step.action.kind === 'read');

    if (readIndex < 0) {
      throw new Error('Fixture read step missing');
    }

    const readStep = artifact.steps[readIndex];

    if (readStep === undefined) {
      throw new Error('Fixture read step missing');
    }

    const steps = [...artifact.steps];

    steps[readIndex] = {
      ...readStep,
      action: {
        kind: 'read',
        source: 'text',
        saveAs: {
          kind: 'outputRef',
          name: 'missingOutput',
        },
      },
    };

    const invalid: CapabilityArtifact = {
      ...artifact,
      steps,
    };

    expectSemanticFailure(invalid, 'undeclared output "missingOutput"');
  });

  it('rejects an undeclared success-condition outputRef', () => {
    const artifact = validArtifact();

    const invalid: CapabilityArtifact = {
      ...artifact,
      successCondition: {
        kind: 'outputPresent',
        output: {
          kind: 'outputRef',
          name: 'missingOutput',
        },
      },
    };

    expectSemanticFailure(invalid, 'undeclared output "missingOutput"');
  });

  it('validates output refs nested inside all success conditions', () => {
    const artifact = validArtifact();

    const invalid = {
      ...artifact,
      successCondition: {
        kind: 'all',
        conditions: [
          {
            kind: 'surface',
            condition: {
              kind: 'loadingComplete',
            },
          },
          {
            kind: 'outputPresent',
            output: {
              kind: 'outputRef',
              name: 'missingNestedOutput',
            },
          },
        ],
      },
    } satisfies CapabilityArtifact;

    expectSemanticFailure(invalid, 'undeclared output "missingNestedOutput"');
  });

  it('rejects duplicate known business outcome codes', () => {
    const artifact = validArtifact();

    const outcome = artifact.knownBusinessOutcomes?.[0];

    if (outcome === undefined) {
      throw new Error('Fixture business outcome missing');
    }

    const invalid: CapabilityArtifact = {
      ...artifact,
      knownBusinessOutcomes: [
        ...(artifact.knownBusinessOutcomes ?? []),
        {
          ...outcome,
        },
      ],
    };

    expectSemanticFailure(invalid, 'Duplicate known business outcome code');
  });

  it('rejects duplicate recovery rules for the same condition', () => {
    const artifact = validArtifact();

    const firstStep = artifact.steps[0];

    if (firstStep === undefined) {
      throw new Error('Fixture step missing');
    }

    const retry = {
      kind: 'retry' as const,
      condition: 'TRANSIENT_LOAD' as const,
      maxAttempts: 2,
      wait: {
        timeoutMs: 1_000,
        pollIntervalMs: 100,
      },
    };

    const invalid: CapabilityArtifact = {
      ...artifact,
      steps: [
        {
          ...firstStep,
          recovery: [
            retry,
            {
              ...retry,
            },
          ],
        },
        ...artifact.steps.slice(1),
      ],
    };

    expectSemanticFailure(invalid, 'multiple recovery rules for condition "TRANSIENT_LOAD"');
  });

  it('rejects maxStepRisk that does not match persisted steps', () => {
    const artifact = validArtifact();

    const invalid: CapabilityArtifact = {
      ...artifact,
      risk: {
        ...artifact.risk,
        maxStepRisk: 'READ_ONLY',
      },
    };

    expectSemanticFailure(invalid, 'does not match highest persisted step risk');
  });

  it('does not require summaryRisk to equal maxStepRisk', () => {
    const artifact = validArtifact();

    expect(artifact.risk.summaryRisk).toBe('READ_ONLY');

    expect(artifact.risk.maxStepRisk).toBe('REVERSIBLE');

    expect(validateCapabilityArtifactSemantics(artifact)).toEqual(artifact);
  });

  it('rejects a required output that no reusable step produces', () => {
    const artifact = validArtifact();

    const readIndex = artifact.steps.findIndex((step) => step.action.kind === 'read');

    if (readIndex < 0) {
      throw new Error('Fixture read step missing');
    }

    const readStep = artifact.steps[readIndex];

    if (readStep === undefined) {
      throw new Error('Fixture read step missing');
    }

    const steps = [...artifact.steps];

    steps[readIndex] = {
      ...readStep,
      action: {
        kind: 'read',
        source: 'text',
        saveAs: {
          kind: 'outputRef',
          name: 'secondaryOutput',
        },
      },
    };

    const invalid: CapabilityArtifact = {
      ...artifact,
      outputs: [
        ...artifact.outputs,
        {
          name: 'secondaryOutput',
          type: 'string',
          required: false,
          description: 'Secondary test output.',
        },
      ],
      steps,
    };

    expectSemanticFailure(invalid, 'Required output "savingsBalance" is not produced');
  });

  it('rejects an artifact with no reusable steps', () => {
    const artifact = validArtifact();

    const invalid = {
      ...artifact,
      steps: [],
    } as unknown as CapabilityArtifact;

    expectSemanticFailure(invalid, 'at least one reusable step');
  });

  it('rejects an explicit wait action without a bounded wait policy', () => {
    const artifact = validArtifact();

    artifact.steps = [
      {
        id: 'wait-for-loading',
        description: 'Wait for loading.',

        action: {
          kind: 'wait',
          condition: {
            kind: 'loadingComplete',
          },
        },

        risk: 'READ_ONLY',
      },
    ];

    expect(() => validateCapabilityArtifactSemantics(artifact)).toThrow(
      /requires an explicit bounded wait policy/,
    );
  });
});
