import { describe, expect, it } from 'vitest';

import {
  ArtifactCompiler,
  ArtifactCompilerEligibilityError,
  type DiscoveryArtifactSource,
} from '../../src/artifact/index.js';

import {
  createCompileOptions as options,
  createCompilerSource as source,
} from '../helpers/artifact-compiler-fixture.js';

describe('ArtifactCompiler', () => {
  it('rejects a required input when neither request nor compiler parameter metadata provides it', () => {
    const compiler = new ArtifactCompiler();

    const base = source();

    const requestWithoutParameters = {
      goal: base.request.goal,
      target: base.request.target,
    };

    const sourceWithoutParameters = {
      ...base,
      request: requestWithoutParameters,
    };

    expect(() => compiler.compile(sourceWithoutParameters, options())).toThrowError(
      expect.objectContaining({
        code: 'ARTIFACT_PARAMETER_BINDING_INVALID',
      }),
    );
  });

  it('rejects incomplete discovery without a completion decision', () => {
    const compiler = new ArtifactCompiler();

    const base = source();

    const incompleteSource = {
      ...base,
      trace: base.trace.filter(
        (record) => !(record.kind === 'model_decision' && record.decision.kind === 'complete'),
      ),
    };

    expect(() => compiler.compile(incompleteSource, options())).toThrowError(
      expect.objectContaining({
        eligibilityCode: 'INCOMPLETE_DISCOVERY',
      }),
    );
  });

  it('rejects multiple completion decisions', () => {
    const compiler = new ArtifactCompiler();

    const base = source();

    const completion = base.trace.find(
      (record) => record.kind === 'model_decision' && record.decision.kind === 'complete',
    );

    if (
      completion === undefined ||
      completion.kind !== 'model_decision' ||
      completion.decision.kind !== 'complete'
    ) {
      throw new Error('Fixture completion missing');
    }

    const unsupportedSource = {
      ...base,
      trace: [
        ...base.trace,
        {
          ...completion,
          step: completion.step + 1,
        },
      ],
    };

    expect(() => compiler.compile(unsupportedSource, options())).toThrowError(
      expect.objectContaining({
        eligibilityCode: 'UNSUPPORTED_COMPLETION',
      }),
    );
  });

  it('compiles a successful Phase 2 discovery into a reusable artifact', () => {
    const compiler = new ArtifactCompiler();

    const artifact = compiler.compile(source(), options());

    expect(artifact.identity.id).toBe('lookup_savings_balance');

    expect(artifact.steps.map((step) => step.id)).toEqual([
      'enter-member-search',
      'submit-member-search',
      'open-accounts',
      'read-savings-balance',
    ]);

    expect(artifact.outputs).toEqual([
      expect.objectContaining({
        name: 'savingsBalance',
        type: 'currency',
      }),
    ]);
  });

  it('parameterizes the concrete member name', () => {
    const compiler = new ArtifactCompiler();

    const artifact = compiler.compile(source(), options());

    expect(artifact.steps[0]?.action).toEqual({
      kind: 'type',
      value: {
        kind: 'inputRef',
        name: 'memberName',
      },
      mode: 'replace',
    });

    expect(JSON.stringify(artifact)).not.toContain('Alex Morgan');
  });

  it('maps the discovery extraction to the reusable output', () => {
    const compiler = new ArtifactCompiler();

    const artifact = compiler.compile(source(), options());

    expect(artifact.steps[3]?.action).toEqual({
      kind: 'read',
      source: 'text',
      saveAs: {
        kind: 'outputRef',
        name: 'savingsBalance',
      },
    });

    expect(JSON.stringify(artifact)).not.toContain('$12,840.50');

    expect(JSON.stringify(artifact)).not.toContain('alexMorganSavingsBalance');
  });

  it('does not compile the discovery complete decision as an artifact step', () => {
    const compiler = new ArtifactCompiler();

    const artifact = compiler.compile(source(), options());

    expect(artifact.steps).toHaveLength(4);

    expect(
      artifact.steps.some(
        (step) =>
          (
            step.action as {
              kind: string;
            }
          ).kind === 'complete',
      ),
    ).toBe(false);
  });

  it('preserves Phase 2 policy risk classification per successful step', () => {
    const compiler = new ArtifactCompiler();

    const artifact = compiler.compile(source(), options());

    expect(artifact.steps.map((step) => step.risk)).toEqual([
      'REVERSIBLE',
      'REVERSIBLE',
      'READ_ONLY',
      'READ_ONLY',
    ]);
  });

  it('is deterministic for the same source and compile options', () => {
    const compiler = new ArtifactCompiler();

    const first = compiler.compile(source(), options());

    const second = compiler.compile(source(), options());

    expect(second).toEqual(first);
  });

  it('uses DiscoveryRequest.parameters before compiler parameter metadata', () => {
    const compiler = new ArtifactCompiler();

    const artifact = compiler.compile(source(), options());

    expect(artifact.steps[0]?.action).toEqual({
      kind: 'type',
      value: {
        kind: 'inputRef',
        name: 'memberName',
      },
      mode: 'replace',
    });
  });

  it('uses explicit compiler parameter metadata when request metadata is unavailable', () => {
    const compiler = new ArtifactCompiler();

    const base = source();

    const sourceWithoutRequestParameters = {
      ...base,
      request: {
        ...base.request,
        parameters: undefined,
      },
    };

    const compileOptions = {
      ...options(),
      parameters: {
        memberName: {
          discoveryValue: 'Alex Morgan',
        },
      },
    };

    const artifact = compiler.compile(sourceWithoutRequestParameters, compileOptions);

    expect(artifact.steps[0]?.action).toEqual({
      kind: 'type',
      value: {
        kind: 'inputRef',
        name: 'memberName',
      },
      mode: 'replace',
    });
  });

  it('rejects conflicting request and compiler parameter metadata', () => {
    const compiler = new ArtifactCompiler();

    expect(() =>
      compiler.compile(source(), {
        ...options(),
        parameters: {
          memberName: {
            discoveryValue: 'Different Person',
          },
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'ARTIFACT_PARAMETER_BINDING_INVALID',
      }),
    );
  });

  it('rejects missing verified extracted output', () => {
    const compiler = new ArtifactCompiler();

    const base = source();

    const missingExtractionSource = {
      ...base,
      extractions: [],
    };

    expect(() => compiler.compile(missingExtractionSource, options())).toThrowError(
      expect.objectContaining({
        eligibilityCode: 'MISSING_REQUIRED_OUTPUT',
      }),
    );
  });

  it('rejects a successful action with unresolved target evidence', () => {
    const compiler = new ArtifactCompiler();

    const base = source();

    const unresolvedSource = {
      ...base,
      trace: base.trace.map((record) =>
        record.kind === 'target_resolution' && record.step === 3
          ? {
              ...record,
              status: 'failure' as const,
              errorCode: 'TARGET_NOT_FOUND',
            }
          : record,
      ),
    };

    expect(() => compiler.compile(unresolvedSource, options())).toThrowError(
      expect.objectContaining({
        eligibilityCode: 'UNSAFE_UNRESOLVED_ACTION',
      }),
    );
  });

  it('returns typed compiler eligibility errors', () => {
    const compiler = new ArtifactCompiler();

    const base = source();

    const invalidSource = {
      ...base,
      trace: [],
    };

    try {
      compiler.compile(invalidSource, options());

      throw new Error('Expected compilation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ArtifactCompilerEligibilityError);

      if (error instanceof ArtifactCompilerEligibilityError) {
        expect(error.eligibilityCode).toBe('INCOMPLETE_DISCOVERY');

        expect(error.code).toBe('ARTIFACT_SOURCE_INVALID');
      }
    }
  });

  it('rejects an invalid persisted discovery trace', () => {
    const compiler = new ArtifactCompiler();

    const base = source();

    const invalidSource = {
      ...base,
      trace: [
        ...base.trace,
        {
          kind: 'target_resolution',
          step: 99,
          targetDescription: 'Broken target',
          status: 'resolved',
          attempts: [
            {
              strategyIndex: -1,
              strategyKind: 'role-name',
              outcome: 'resolved',
              matchCount: 1,
            },
          ],
          errorCode: null,
        } as never,
      ],
    };

    expect(() => compiler.compile(invalidSource, options())).toThrowError(
      expect.objectContaining({
        eligibilityCode: 'INVALID_TRACE',
      }),
    );
  });

  it('rejects failed discovery sources with a typed eligibility error', () => {
    const compiler = new ArtifactCompiler();

    const base = source();

    const failedSource: DiscoveryArtifactSource = {
      ...base,
      result: {
        runId: base.runId,
        sessionId: 'session-1',
        startedAt: '2026-09-18T15:00:00.000Z',
        finishedAt: '2026-09-18T15:00:05.000Z',
        durationMs: 5_000,
        evidenceRefs: [],
        recoverableConditions: [],
        steps: 5,
        status: 'failure',
        error: {
          code: 'ACTION_FAILED',
          message: 'Action failed',
          stepId: '4',
          expected: 'successful action',
          observed: 'failure',
          details: {
            phase: 'discovery_loop',
          },
        },
      },
    };

    expect(() => compiler.compile(failedSource, options())).toThrowError(
      expect.objectContaining({
        eligibilityCode: 'FAILED_DISCOVERY',
        code: 'ARTIFACT_SOURCE_NOT_SUCCESSFUL',
      }),
    );
  });

  it('rejects business-outcome discovery sources with a typed eligibility error', () => {
    const compiler = new ArtifactCompiler();

    const base = source();

    const businessOutcomeSource: DiscoveryArtifactSource = {
      ...base,
      result: {
        runId: base.runId,
        sessionId: 'session-1',
        startedAt: '2026-09-18T15:00:00.000Z',
        finishedAt: '2026-09-18T15:00:05.000Z',
        durationMs: 5_000,
        evidenceRefs: [],
        recoverableConditions: [],
        steps: 5,
        status: 'business_outcome',
        outcome: {
          code: 'PERMISSION_DENIED',
          message: 'Access is restricted',
          details: {
            step: 4,
          },
        },
      },
    };

    expect(() => compiler.compile(businessOutcomeSource, options())).toThrowError(
      expect.objectContaining({
        eligibilityCode: 'BUSINESS_OUTCOME_DISCOVERY',
        code: 'ARTIFACT_SOURCE_NOT_SUCCESSFUL',
      }),
    );
  });

  it('rejects intervention-required discovery sources with a typed eligibility error', () => {
    const compiler = new ArtifactCompiler();

    const base = source();

    const interventionSource: DiscoveryArtifactSource = {
      ...base,
      result: {
        runId: base.runId,
        sessionId: 'session-1',
        startedAt: '2026-09-18T15:00:00.000Z',
        finishedAt: '2026-09-18T15:00:05.000Z',
        durationMs: 5_000,
        evidenceRefs: [],
        recoverableConditions: [],
        steps: 5,
        status: 'intervention_required',
        intervention: {
          interventionId: 'intervention-1',
          code: 'AUTOMATION_STUCK',
          message: 'Unable to identify a unique target safely',
          requestedOwner: 'HUMAN',
          resumable: false,
          context: {
            source: 'target_resolver',
          },
        },
      },
    };

    expect(() => compiler.compile(interventionSource, options())).toThrowError(
      expect.objectContaining({
        eligibilityCode: 'INTERVENTION_REQUIRED_DISCOVERY',
        code: 'ARTIFACT_SOURCE_NOT_SUCCESSFUL',
      }),
    );
  });

  it('rejects a required output missing from the final discovery result', () => {
    const compiler = new ArtifactCompiler();

    const base = source();

    if (base.result.status !== 'success') {
      throw new Error('Fixture must be a successful discovery');
    }

    const missingResultOutputSource: DiscoveryArtifactSource = {
      ...base,
      result: {
        ...base.result,
        outputs: {},
      },
    };

    expect(() => compiler.compile(missingResultOutputSource, options())).toThrowError(
      expect.objectContaining({
        eligibilityCode: 'MISSING_REQUIRED_OUTPUT',
        code: 'ARTIFACT_OUTPUT_BINDING_INVALID',
      }),
    );
  });

  it('rejects a required output missing from the completion decision', () => {
    const compiler = new ArtifactCompiler();

    const base = source();

    const traceWithoutCompletionOutput = base.trace.map((record) => {
      if (record.kind === 'model_decision' && record.decision.kind === 'complete') {
        return {
          ...record,
          decision: {
            ...record.decision,
            outputs: {},
          },
        };
      }

      return record;
    });

    const missingCompletionOutputSource: DiscoveryArtifactSource = {
      ...base,
      trace: traceWithoutCompletionOutput,
    };

    expect(() => compiler.compile(missingCompletionOutputSource, options())).toThrowError(
      expect.objectContaining({
        eligibilityCode: 'MISSING_REQUIRED_OUTPUT',
        code: 'ARTIFACT_OUTPUT_BINDING_INVALID',
      }),
    );
  });
});
