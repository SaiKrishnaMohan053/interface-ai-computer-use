import type { CompileOptions, DiscoveryArtifactSource } from '../../src/artifact/index.js';

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

export function createCompilerSource(): DiscoveryArtifactSource {
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

export function createCompileOptions(): CompileOptions {
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
