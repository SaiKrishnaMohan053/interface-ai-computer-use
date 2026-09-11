import { describe, expect, it } from 'vitest';

import { createDiscoveryIntervention } from '../../src/discovery/index.js';

const base = {
  goal: 'Look up Alex Morgan and return their current savings balance.',

  step: 4,

  observationId: 'observation-4',

  location: 'http://127.0.0.1:3000/member/alex-morgan/accounts',
};

const idOptions = {
  createId: () => 'intervention-1',
};

describe('discovery escalation', () => {
  it('supports an explicit model escalation request', () => {
    expect(
      createDiscoveryIntervention(
        {
          ...base,
          source: 'model',

          decision: {
            kind: 'escalate',

            reasonCode: 'AUTOMATION_STUCK',

            reason: 'Unable to identify a unique target safely.',
          },
        },
        idOptions,
      ),
    ).toMatchObject({
      interventionId: 'intervention-1',

      code: 'AUTOMATION_STUCK',

      message: 'Unable to identify a unique target safely.',

      requestedOwner: 'HUMAN',
      resumable: false,

      context: {
        source: 'model',

        requestedBy: 'discovery_model',
      },
    });
  });

  it('forces escalation from a policy REQUIRE_HUMAN decision', () => {
    const intervention = createDiscoveryIntervention(
      {
        ...base,
        source: 'policy',

        actionKind: 'click',

        policyDecision: {
          policyId: 'banking-policy',

          decision: 'REQUIRE_HUMAN',

          code: 'HUMAN_APPROVAL_REQUIRED',

          riskLevel: 'IRREVERSIBLE',

          matchedRuleId: 'submit-requires-human',

          reason: 'Final submission requires human approval',
        },
      },
      idOptions,
    );

    expect(intervention).toMatchObject({
      code: 'HUMAN_APPROVAL_REQUIRED',

      message: 'Final submission requires human approval',

      context: {
        source: 'policy',

        requestedBy: 'policy_engine',

        actionKind: 'click',

        riskLevel: 'IRREVERSIBLE',
      },
    });
  });

  it('forces escalation when repeated-state threshold is reached', () => {
    const intervention = createDiscoveryIntervention(
      {
        ...base,

        source: 'repeated_state',

        repeatedStateCount: 3,
        threshold: 3,
      },
      idOptions,
    );

    expect(intervention).toMatchObject({
      code: 'AUTOMATION_STUCK',

      context: {
        source: 'repeated_state',

        requestedBy: 'stuck_detector',

        repeatedStateCount: 3,
        threshold: 3,
      },
    });
  });

  it('does not escalate before the repeated-state threshold', () => {
    expect(() =>
      createDiscoveryIntervention(
        {
          ...base,

          source: 'repeated_state',

          repeatedStateCount: 2,
          threshold: 3,
        },
        idOptions,
      ),
    ).toThrow('Repeated-state escalation requires the configured threshold to be reached');
  });

  it('forces escalation for persistent target ambiguity', () => {
    const intervention = createDiscoveryIntervention(
      {
        ...base,

        source: 'unsafe_ambiguity',

        targetDescription: 'Accounts navigation link',

        resolutionAttempts: 2,
      },
      idOptions,
    );

    expect(intervention).toMatchObject({
      code: 'AUTOMATION_STUCK',

      message: 'Unable to identify a unique target safely',

      context: {
        source: 'unsafe_ambiguity',

        requestedBy: 'target_resolver',

        targetDescription: 'Accounts navigation link',

        resolutionAttempts: 2,

        failureCode: 'TARGET_AMBIGUOUS',
      },
    });
  });

  it('rejects invalid ambiguity escalation metadata', () => {
    expect(() =>
      createDiscoveryIntervention(
        {
          ...base,

          source: 'unsafe_ambiguity',

          targetDescription: 'Accounts navigation link',

          resolutionAttempts: 0,
        },
        idOptions,
      ),
    ).toThrow('Resolution attempts must be a positive integer');
  });

  it('rejects an empty generated intervention ID', () => {
    expect(() =>
      createDiscoveryIntervention(
        {
          ...base,
          source: 'model',

          decision: {
            kind: 'escalate',

            reasonCode: 'RECOVERY_EXHAUSTED',

            reason: 'Recovery attempts were exhausted',
          },
        },
        {
          createId: () => ' ',
        },
      ),
    ).toThrow('Intervention ID must not be empty');
  });
});
