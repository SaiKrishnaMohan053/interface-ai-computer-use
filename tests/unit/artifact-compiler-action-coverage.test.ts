import { describe, expect, it } from 'vitest';

import {
  ArtifactCompiler,
  ArtifactCompilerUnsupportedActionError,
} from '../../src/artifact/index.js';

import type { CompileOptions, DiscoveryArtifactSource } from '../../src/artifact/index.js';

import type { DiscoveryTraceRecord } from '../../src/discovery/index.js';

import {
  createCompileOptions,
  createCompilerSource,
} from '../helpers/artifact-compiler-fixture.js';

function replaceReusableStep(
  source: DiscoveryArtifactSource,
  sourceStep: number,
  records: readonly DiscoveryTraceRecord[],
): DiscoveryArtifactSource {
  return {
    ...source,

    trace: [...source.trace.filter((record) => record.step !== sourceStep), ...records].sort(
      (left, right) => left.step - right.step,
    ),
  };
}

function targetResolutionRecord(step: number): DiscoveryTraceRecord {
  return {
    kind: 'target_resolution',
    step,
    targetDescription: 'Resolved semantic target',
    status: 'resolved',

    attempts: [
      {
        strategyIndex: 0,
        strategyKind: 'label',
        outcome: 'resolved',
        matchCount: 1,
      },
    ],

    errorCode: null,
  };
}

function allowPolicyRecord(
  step: number,
  actionKind: 'select' | 'check' | 'uncheck' | 'navigate' | 'wait' | 'dismiss',
): DiscoveryTraceRecord {
  return {
    kind: 'policy_decision',
    step,
    actionKind,
    systemRiskLevel: 'REVERSIBLE',

    policyDecision: {
      policyId: 'default',
      matchedRuleId: null,
      reason: 'Allowed for compiler action coverage test.',
      decision: 'ALLOW',
      riskLevel: 'REVERSIBLE',
    },
  };
}

function successfulActionResult(
  step: number,
  actionKind: 'select' | 'check' | 'uncheck' | 'navigate' | 'wait' | 'dismiss',
): DiscoveryTraceRecord {
  return {
    kind: 'action_result',
    step,
    actionKind,
    status: 'success',
    errorCode: null,
    extractedValues: {},
    evidenceRefs: [],
  };
}

function selectTarget() {
  return {
    description: 'Account Type selector',

    strategies: [
      {
        kind: 'label' as const,

        label: {
          value: 'Account Type',
          mode: 'exact' as const,
          caseSensitive: false,
        },
      },
    ],

    cardinality: 'exactly-one' as const,
  };
}

function checkboxTarget() {
  return {
    description: 'Include closed accounts checkbox',

    strategies: [
      {
        kind: 'label' as const,

        label: {
          value: 'Include closed accounts',
          mode: 'exact' as const,
          caseSensitive: false,
        },
      },
    ],

    cardinality: 'exactly-one' as const,
  };
}

function optionsWithAccountType(base: CompileOptions): CompileOptions {
  return {
    ...base,

    inputs: [
      ...base.inputs,

      {
        name: 'accountType',
        type: 'string',
        required: true,
        description: 'Account type selected in the form.',
        sensitive: false,
      },
    ],
  };
}

function sourceWithAccountType(base: DiscoveryArtifactSource): DiscoveryArtifactSource {
  return {
    ...base,

    request: {
      ...base.request,

      parameters: {
        ...(base.request.parameters ?? {}),
        accountType: 'Savings',
      },
    },
  };
}

describe('ArtifactCompiler action coverage', () => {
  it('compiles select using an explicitly declared input parameter', () => {
    const compiler = new ArtifactCompiler();

    const baseSource = sourceWithAccountType(createCompilerSource());

    const compileOptions = optionsWithAccountType(createCompileOptions());

    const source = replaceReusableStep(baseSource, 2, [
      {
        kind: 'model_decision',
        step: 2,

        decision: {
          kind: 'select',
          target: selectTarget(),

          option: {
            kind: 'label',
            label: 'Savings',
          },

          reason: 'Select the requested account type.',
        },

        rationale: 'Select the requested account type.',
      },

      allowPolicyRecord(2, 'select'),

      targetResolutionRecord(2),

      successfulActionResult(2, 'select'),
    ]);

    const artifact = compiler.compile(source, compileOptions);

    const step = artifact.steps.find((candidate) => candidate.action.kind === 'select');

    expect(step).toBeDefined();

    expect(step?.action).toEqual({
      kind: 'select',

      option: {
        kind: 'label',

        label: {
          kind: 'inputRef',
          name: 'accountType',
        },
      },
    });

    expect(step?.target).toBeDefined();
  });

  it('rejects a select option that is not backed by a declared parameter', () => {
    const compiler = new ArtifactCompiler();

    const baseSource = createCompilerSource();

    const source = replaceReusableStep(baseSource, 2, [
      {
        kind: 'model_decision',
        step: 2,

        decision: {
          kind: 'select',
          target: selectTarget(),

          option: {
            kind: 'label',
            label: 'Savings',
          },

          reason: 'Select an account type.',
        },

        rationale: 'Select an account type.',
      },

      allowPolicyRecord(2, 'select'),

      targetResolutionRecord(2),

      successfulActionResult(2, 'select'),
    ]);

    expect(() => compiler.compile(source, createCompileOptions())).toThrowError(
      expect.objectContaining({
        code: 'ARTIFACT_PARAMETER_BINDING_INVALID',
      }),
    );
  });

  it('compiles check with its semantic target', () => {
    const compiler = new ArtifactCompiler();

    const source = replaceReusableStep(createCompilerSource(), 2, [
      {
        kind: 'model_decision',
        step: 2,

        decision: {
          kind: 'check',
          target: checkboxTarget(),

          reason: 'Enable the option.',
        },

        rationale: 'Enable the option.',
      },

      allowPolicyRecord(2, 'check'),

      targetResolutionRecord(2),

      successfulActionResult(2, 'check'),
    ]);

    const artifact = compiler.compile(source, createCompileOptions());

    const step = artifact.steps.find((candidate) => candidate.action.kind === 'check');

    expect(step).toBeDefined();

    expect(step?.action).toEqual({
      kind: 'check',
    });

    expect(step?.target).toMatchObject({
      description: 'Include closed accounts checkbox',

      cardinality: 'exactly-one',
    });
  });

  it('compiles uncheck with its semantic target', () => {
    const compiler = new ArtifactCompiler();

    const source = replaceReusableStep(createCompilerSource(), 2, [
      {
        kind: 'model_decision',
        step: 2,

        decision: {
          kind: 'uncheck',
          target: checkboxTarget(),

          reason: 'Disable the option.',
        },

        rationale: 'Disable the option.',
      },

      allowPolicyRecord(2, 'uncheck'),

      targetResolutionRecord(2),

      successfulActionResult(2, 'uncheck'),
    ]);

    const artifact = compiler.compile(source, createCompileOptions());

    const step = artifact.steps.find((candidate) => candidate.action.kind === 'uncheck');

    expect(step).toBeDefined();

    expect(step?.action).toEqual({
      kind: 'uncheck',
    });

    expect(step?.target).toMatchObject({
      description: 'Include closed accounts checkbox',

      cardinality: 'exactly-one',
    });
  });

  it('explicitly rejects navigate with a typed compiler error', () => {
    const compiler = new ArtifactCompiler();

    const source = replaceReusableStep(createCompilerSource(), 2, [
      {
        kind: 'model_decision',
        step: 2,

        decision: {
          kind: 'navigate',

          destination: 'https://example.test/accounts',

          reason: 'Navigate to the accounts page.',
        },

        rationale: 'Navigate to the accounts page.',
      },

      allowPolicyRecord(2, 'navigate'),

      successfulActionResult(2, 'navigate'),
    ]);

    try {
      compiler.compile(source, createCompileOptions());

      expect.fail('Expected navigate compilation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ArtifactCompilerUnsupportedActionError);

      expect(error).toMatchObject({
        name: 'ArtifactCompilerUnsupportedActionError',

        code: 'ARTIFACT_SOURCE_INVALID',

        actionKind: 'navigate',
      });
    }
  });

  it('explicitly rejects wait with a typed compiler error', () => {
    const compiler = new ArtifactCompiler();

    const source = replaceReusableStep(createCompilerSource(), 2, [
      {
        kind: 'model_decision',
        step: 2,

        decision: {
          kind: 'wait',

          condition: {
            kind: 'loadingComplete',
          },

          reason: 'Wait for loading to finish.',
        },

        rationale: 'Wait for loading to finish.',
      },

      allowPolicyRecord(2, 'wait'),

      successfulActionResult(2, 'wait'),
    ]);

    try {
      compiler.compile(source, createCompileOptions());

      expect.fail('Expected wait compilation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ArtifactCompilerUnsupportedActionError);

      expect(error).toMatchObject({
        name: 'ArtifactCompilerUnsupportedActionError',

        code: 'ARTIFACT_SOURCE_INVALID',

        actionKind: 'wait',
      });
    }
  });

  it('explicitly rejects dismiss with a typed compiler error', () => {
    const compiler = new ArtifactCompiler();

    const source = replaceReusableStep(createCompilerSource(), 2, [
      {
        kind: 'model_decision',
        step: 2,

        decision: {
          kind: 'dismiss',

          dialog: {
            kind: 'native',
            observationId: 'observation-dialog-1',
            dialogId: 'dialog-1',

            response: {
              kind: 'dismiss',
            },
          },

          reason: 'Dismiss the native dialog.',
        },

        rationale: 'Dismiss the native dialog.',
      },

      allowPolicyRecord(2, 'dismiss'),

      successfulActionResult(2, 'dismiss'),
    ]);

    try {
      compiler.compile(source, createCompileOptions());

      expect.fail('Expected dismiss compilation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ArtifactCompilerUnsupportedActionError);

      expect(error).toMatchObject({
        name: 'ArtifactCompilerUnsupportedActionError',

        code: 'ARTIFACT_SOURCE_INVALID',

        actionKind: 'dismiss',
      });
    }
  });
});
