import { describe, expect, it } from 'vitest';

import {
  parseHumanActionRecord,
  parseInterventionContext,
  parseInterventionRequest,
  parseInterventionResolution,
} from '../../src/intervention/index.js';

const NOW = '2026-09-21T18:00:00.000Z';

describe('intervention contracts', () => {
  it('accepts a sanitized discovery intervention request', () => {
    const request = parseInterventionRequest({
      id: 'intervention-1',

      sessionId: 'session-1',

      source: 'DISCOVERY',

      goal: "Read the member's savings balance",

      stepId: '4',

      reasonCode: 'AUTOMATION_STUCK',

      reason: 'Unable to identify a unique target safely',

      observedState: 'Member details page with multiple matching Accounts controls',

      evidenceRefs: [],

      createdAt: NOW,

      status: 'REQUESTED',
    });

    expect(request).toMatchObject({
      id: 'intervention-1',
      source: 'DISCOVERY',
      reasonCode: 'AUTOMATION_STUCK',
      status: 'REQUESTED',
    });
  });

  it('accepts replay capability context', () => {
    const context = parseInterventionContext({
      source: 'REPLAY',

      capabilityId: 'prepare_new_savings_subaccount',

      capabilityVersion: '1.0.0',

      stepId: 'confirm-create',

      observedState: 'Sub-account creation review screen',

      location: 'http://127.0.0.1:3000/member/demo/sub-account/review',

      actionKind: 'click',

      riskLevel: 'IRREVERSIBLE',

      details: {
        policyDecision: 'REQUIRE_HUMAN',
      },
    });

    expect(context.riskLevel).toBe('IRREVERSIBLE');
  });

  it('accepts a resume resolution', () => {
    expect(
      parseInterventionResolution({
        kind: 'RESUME',

        code: 'MANUAL_ACTION_COMPLETED',

        summary: 'Human completed the final confirmation step',

        resolvedAt: NOW,

        evidenceRefs: [],
      }),
    ).toMatchObject({
      kind: 'RESUME',
      code: 'MANUAL_ACTION_COMPLETED',
    });
  });

  it('accepts an abort resolution', () => {
    expect(
      parseInterventionResolution({
        kind: 'ABORT',

        code: 'HUMAN_ABORTED',

        summary: 'Human chose not to continue the operation',

        resolvedAt: NOW,

        evidenceRefs: [],
      }),
    ).toMatchObject({
      kind: 'ABORT',
      code: 'HUMAN_ABORTED',
    });
  });

  it('rejects inconsistent resolution semantics', () => {
    expect(() =>
      parseInterventionResolution({
        kind: 'ABORT',

        code: 'MANUAL_ACTION_COMPLETED',

        summary: 'Invalid resolution',

        resolvedAt: NOW,

        evidenceRefs: [],
      }),
    ).toThrow();
  });

  it('accepts a semantic human action audit record', () => {
    const action = parseHumanActionRecord({
      actionId: 'human-action-1',

      interventionId: 'intervention-1',

      sessionId: 'session-1',

      kind: 'MANUAL_STEP',

      summary: 'Human confirmed the reviewed sub-account creation',

      occurredAt: NOW,

      evidenceRefs: [],

      details: {
        stepId: 'confirm-create',
      },
    });

    expect(action.kind).toBe('MANUAL_STEP');
  });

  it('rejects browser handles and undeclared persisted fields', () => {
    expect(() =>
      parseInterventionRequest({
        id: 'intervention-1',

        sessionId: 'session-1',

        source: 'REPLAY',

        reasonCode: 'HUMAN_APPROVAL_REQUIRED',

        reason: 'Final create requires a human',

        observedState: 'Review screen',

        evidenceRefs: [],

        createdAt: NOW,

        status: 'REQUESTED',

        page: {
          opaqueBrowserHandle: true,
        },
      }),
    ).toThrow();
  });

  it('rejects unknown intervention reason codes', () => {
    expect(() =>
      parseInterventionRequest({
        id: 'intervention-1',

        sessionId: 'session-1',

        source: 'REPLAY',

        reasonCode: 'MODEL_SAID_SO',

        reason: 'Unsupported reason',

        observedState: 'Review screen',

        evidenceRefs: [],

        createdAt: NOW,

        status: 'REQUESTED',
      }),
    ).toThrow();
  });
});
