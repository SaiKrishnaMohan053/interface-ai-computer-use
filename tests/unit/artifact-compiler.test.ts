import { describe, expect, it } from 'vitest';

import {
  ArtifactCompiler,
  ArtifactCompilerEligibilityError,
  type CompileOptions,
  type DiscoveryArtifactSource,
} from '../../src/artifact/index.js';

import type { AgentTargetSpec } from '../../src/discovery/index.js';

function memberNameTarget(): AgentTargetSpec {
  return {
    description: 'Member Name input',
    strategies: [
      {
        kind: 'role-name',
        role: 'textbox',
        name: {
          value: 'Member Name',
          mode: 'exact',
          caseSensitive: false,
        },
      },
    ],
    cardinality: 'exactly-one',
  };
}

function searchTarget(): AgentTargetSpec {
  return {
    description: 'Search button',
    strategies: [
      {
        kind: 'role-name',
        role: 'button',
        name: {
          value: 'Search',
          mode: 'exact',
          caseSensitive: false,
        },
      },
    ],
    cardinality: 'exactly-one',
  };
}

function accountsTarget(): AgentTargetSpec {
  return {
    description: 'Accounts navigation',
    strategies: [
      {
        kind: 'role-name',
        role: 'link',
        name: {
          value: 'Accounts',
          mode: 'exact',
          caseSensitive: false,
        },
      },
    ],
    cardinality: 'exactly-one',
  };
}

function savingsBalanceTarget(): AgentTargetSpec {
  return {
    description: 'Savings Current Balance cell in Accounts table',
    strategies: [
      {
        kind: 'structural',
        query: {
          kind: 'table-cell',
          table: {
            name: {
              value: 'Accounts',
              mode: 'contains',
              caseSensitive: false,
            },
          },
          row: {
            columnHeader: {
              value: 'Account Type',
              mode: 'exact',
              caseSensitive: false,
            },
            value: {
              value: 'Savings',
              mode: 'exact',
              caseSensitive: false,
            },
          },
          column: {
            header: {
              value: 'Current Balance',
              mode: 'exact',
              caseSensitive: false,
            },
          },
        },
      },
    ],
    cardinality: 'exactly-one',
  };
}

function source(): DiscoveryArtifactSource {
  return {
    runId: '9635c0c9-dc3a-4b64-aa38-b1f48a359ea0',

    request: {
      goal: 'Look up Alex Morgan and return their current savings balance.',
      target: {
        entryUrl: 'http://127.0.0.1:3000/member-search',
        application: 'demo-bank',
      },
      parameters: {
        memberName: 'Alex Morgan',
      },
    },

    result: {
      status: 'success',
      runId: '9635c0c9-dc3a-4b64-aa38-b1f48a359ea0',
      sessionId: 'discovery-session-1',
      startedAt: '2026-09-18T15:00:00.000Z',
      finishedAt: '2026-09-18T15:00:05.000Z',
      durationMs: 5_000,
      outputs: {
        alexMorganSavingsBalance: '$12,840.50',
      },
      evidenceRefs: [],
      recoverableConditions: [],
      steps: 5,
    },

    extractions: [
      {
        outputName: 'alexMorganSavingsBalance',
        value: '$12,840.50',
        source: 'surface_read',
        step: 4,
        observationId: 'observation-4',
        actionId: 'action-4',
      },
    ],

    trace: [
      {
        kind: 'model_decision',
        step: 1,
        decision: {
          kind: 'type',
          target: memberNameTarget(),
          text: 'Alex Morgan',
          mode: 'replace',
          reason: 'Enter the member name.',
        },
        rationale: 'Enter the member name.',
      },
      {
        kind: 'policy_decision',
        step: 1,
        actionKind: 'type',
        systemRiskLevel: 'REVERSIBLE',
        policyDecision: {
          policyId: 'default',
          matchedRuleId: null,
          reason: 'Reversible member search input allowed.',
          decision: 'ALLOW',
          riskLevel: 'REVERSIBLE',
        },
      },
      {
        kind: 'target_resolution',
        step: 1,
        targetDescription: 'Member Name input',
        status: 'resolved',
        attempts: [
          {
            strategyIndex: 0,
            strategyKind: 'role-name',
            outcome: 'resolved',
            matchCount: 1,
          },
        ],
        errorCode: null,
      },
      {
        kind: 'action_result',
        step: 1,
        actionKind: 'type',
        status: 'success',
        errorCode: null,
        extractedValues: {},
        evidenceRefs: [],
      },

      {
        kind: 'model_decision',
        step: 2,
        decision: {
          kind: 'click',
          target: searchTarget(),
          reason: 'Submit the member search.',
        },
        rationale: 'Submit the member search.',
      },
      {
        kind: 'policy_decision',
        step: 2,
        actionKind: 'click',
        systemRiskLevel: 'REVERSIBLE',
        policyDecision: {
          policyId: 'default',
          matchedRuleId: null,
          reason: 'Reversible search action allowed.',
          decision: 'ALLOW',
          riskLevel: 'REVERSIBLE',
        },
      },
      {
        kind: 'target_resolution',
        step: 2,
        targetDescription: 'Search button',
        status: 'resolved',
        attempts: [
          {
            strategyIndex: 0,
            strategyKind: 'role-name',
            outcome: 'resolved',
            matchCount: 1,
          },
        ],
        errorCode: null,
      },
      {
        kind: 'action_result',
        step: 2,
        actionKind: 'click',
        status: 'success',
        errorCode: null,
        extractedValues: {},
        evidenceRefs: [],
      },

      {
        kind: 'model_decision',
        step: 3,
        decision: {
          kind: 'click',
          target: accountsTarget(),
          reason: 'Open Accounts.',
        },
        rationale: 'Open Accounts.',
      },
      {
        kind: 'policy_decision',
        step: 3,
        actionKind: 'click',
        systemRiskLevel: 'READ_ONLY',
        policyDecision: {
          policyId: 'default',
          matchedRuleId: null,
          reason: 'Read-only navigation allowed.',
          decision: 'ALLOW',
          riskLevel: 'READ_ONLY',
        },
      },
      {
        kind: 'target_resolution',
        step: 3,
        targetDescription: 'Accounts navigation',
        status: 'resolved',
        attempts: [
          {
            strategyIndex: 0,
            strategyKind: 'role-name',
            outcome: 'resolved',
            matchCount: 1,
          },
        ],
        errorCode: null,
      },
      {
        kind: 'action_result',
        step: 3,
        actionKind: 'click',
        status: 'success',
        errorCode: null,
        extractedValues: {},
        evidenceRefs: [],
      },

      {
        kind: 'model_decision',
        step: 4,
        decision: {
          kind: 'read',
          target: savingsBalanceTarget(),
          source: 'text',
          saveAs: 'alexMorganSavingsBalance',
          reason: 'Read the Savings current balance.',
        },
        rationale: 'Read the Savings current balance.',
      },
      {
        kind: 'policy_decision',
        step: 4,
        actionKind: 'read',
        systemRiskLevel: 'READ_ONLY',
        policyDecision: {
          policyId: 'default',
          matchedRuleId: null,
          reason: 'Read-only extraction allowed.',
          decision: 'ALLOW',
          riskLevel: 'READ_ONLY',
        },
      },
      {
        kind: 'target_resolution',
        step: 4,
        targetDescription: 'Savings Current Balance cell in Accounts table',
        status: 'resolved',
        attempts: [
          {
            strategyIndex: 0,
            strategyKind: 'structural',
            outcome: 'resolved',
            matchCount: 1,
          },
        ],
        errorCode: null,
      },
      {
        kind: 'action_result',
        step: 4,
        actionKind: 'read',
        status: 'success',
        errorCode: null,
        extractedValues: {
          alexMorganSavingsBalance: '$12,840.50',
        },
        evidenceRefs: [],
      },

      {
        kind: 'model_decision',
        step: 5,
        decision: {
          kind: 'complete',
          summary: 'Savings balance was successfully retrieved.',
          outputs: {
            alexMorganSavingsBalance: '$12,840.50',
          },
        },
        rationale: 'Savings balance was successfully retrieved.',
      },

      {
        kind: 'runtime_event',
        step: 5,
        status: 'success',
        summary: 'Discovery completed successfully.',
      },
    ],
  };
}

function options(): CompileOptions {
  return {
    compiledAt: '2026-09-18T16:00:00.000Z',

    sourceGoal: 'Look up a member and return their current savings balance.',

    identity: {
      id: 'lookup_savings_balance',
      name: 'Lookup Savings Balance',
      version: '1.0.0',
      description:
        'Searches for a member and returns the current balance of their Savings account.',
    },

    compatibility: {
      application: 'demo-bank',
      vendorFamily: 'demo-core',
      surfaceKind: 'web',
      supportedVersionRange: '1.x',
    },

    inputs: [
      {
        name: 'memberName',
        type: 'string',
        required: true,
        description: 'Member name used for search.',
        sensitive: true,
      },
    ],

    outputs: [
      {
        name: 'savingsBalance',
        type: 'currency',
        required: true,
        description: "Current balance of the member's Savings account.",
      },
    ],

    preconditions: [
      {
        kind: 'textPresent',
        text: 'Member Search',
        match: 'contains',
        caseSensitive: false,
      },
    ],

    steps: [
      {
        sourceStep: 1,
        id: 'enter-member-search',
        description: 'Enter the member name used for search.',
        preconditions: [
          {
            kind: 'elementVisible',
            target: memberNameTarget(),
          },
        ],
      },
      {
        sourceStep: 2,
        id: 'submit-member-search',
        description: 'Submit the member search.',
        postconditions: [
          {
            kind: 'loadingComplete',
          },
          {
            kind: 'textPresent',
            text: 'Member Details',
            match: 'contains',
            caseSensitive: false,
          },
        ],
        wait: {
          timeoutMs: 5_000,
          pollIntervalMs: 100,
        },
      },
      {
        sourceStep: 3,
        id: 'open-accounts',
        description: 'Open the member Accounts view.',
        postconditions: [
          {
            kind: 'elementVisible',
            target: {
              description: 'Accounts table',
              strategies: [
                {
                  kind: 'text',
                  text: {
                    value: 'Accounts',
                    mode: 'exact',
                    caseSensitive: false,
                  },
                },
              ],
              cardinality: 'exactly-one',
            },
          },
        ],
        wait: {
          timeoutMs: 5_000,
          pollIntervalMs: 100,
        },
      },
      {
        sourceStep: 4,
        id: 'read-savings-balance',
        description: 'Read the current balance of the Savings account.',
        preconditions: [
          {
            kind: 'elementVisible',
            target: {
              description: 'Accounts table',
              strategies: [
                {
                  kind: 'text',
                  text: {
                    value: 'Accounts',
                    mode: 'exact',
                    caseSensitive: false,
                  },
                },
              ],
              cardinality: 'exactly-one',
            },
          },
        ],
      },
    ],

    outputBindings: [
      {
        sourceOutputName: 'alexMorganSavingsBalance',
        outputName: 'savingsBalance',
      },
    ],

    knownBusinessOutcomes: [
      {
        code: 'MEMBER_NOT_FOUND',
        description: 'No member matched the supplied lookup input.',
        detector: {
          kind: 'textPresent',
          text: 'Member not found',
          match: 'contains',
          caseSensitive: false,
        },
      },
    ],

    successCondition: {
      kind: 'all',
      conditions: [
        {
          kind: 'surface',
          condition: {
            kind: 'elementVisible',
            target: savingsBalanceTarget(),
          },
        },
        {
          kind: 'outputPresent',
          output: {
            kind: 'outputRef',
            name: 'savingsBalance',
          },
        },
      ],
    },

    risk: {
      summaryRisk: 'READ_ONLY',
      maxStepRisk: 'REVERSIBLE',
      requiresHumanByDefault: false,
      runtimePolicyRequired: true,
    },

    metadata: {},

    forbiddenSourceLiterals: ['Alex Morgan', '$12,840.50'],
  };
}

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
      artifact.steps.some((step) => (step.action as { kind: string }).kind === 'complete'),
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
