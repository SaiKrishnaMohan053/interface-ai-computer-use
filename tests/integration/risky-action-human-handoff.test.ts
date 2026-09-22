import { describe, expect, it, vi } from 'vitest';

import type { CapabilityStep } from '../../src/artifact/index.js';

import {
  InMemoryInterventionStore,
  InterventionController,
  InterventionManager,
  LiveInterventionRegistry,
} from '../../src/intervention/index.js';

import { PolicyEngine } from '../../src/policy/index.js';

import {
  evaluateReplayPolicy,
  executePolicyAuthorizedReplayAction,
} from '../../src/replay/index.js';

import type { CoordinatedRunContext } from '../../src/runtime/index.js';
import type { SessionManager } from '../../src/session/index.js';

class FakeSessionManager {
  readonly sessionId = 'session-risky-handoff';

  state: 'ACTIVE' | 'PAUSED' | 'CLOSED' = 'ACTIVE';

  owner: 'DISCOVERY' | 'REPLAY' | 'HUMAN' | 'NONE' = 'REPLAY';

  closeCalls = 0;

  pause(requestedBy: 'DISCOVERY' | 'REPLAY' | 'HUMAN' | 'NONE'): void {
    if (this.state !== 'ACTIVE' || this.owner !== requestedBy) {
      throw new Error('Invalid pause');
    }

    this.state = 'PAUSED';
  }

  transferOwnership(
    from: 'DISCOVERY' | 'REPLAY' | 'HUMAN',
    to: 'DISCOVERY' | 'REPLAY' | 'HUMAN',
  ): void {
    if (this.state !== 'PAUSED' || this.owner !== from) {
      throw new Error('Invalid ownership transfer');
    }

    this.owner = to;
  }

  releaseOwnership(owner: 'DISCOVERY' | 'REPLAY' | 'HUMAN'): void {
    if (this.owner !== owner) {
      throw new Error('Invalid ownership release');
    }

    this.owner = 'NONE';
  }

  resume(requestedBy: 'DISCOVERY' | 'REPLAY' | 'HUMAN' | 'NONE'): void {
    if (
      this.state !== 'PAUSED' ||
      this.owner !== requestedBy ||
      requestedBy === 'HUMAN' ||
      requestedBy === 'NONE'
    ) {
      throw new Error('Invalid resume');
    }

    this.state = 'ACTIVE';
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    this.state = 'CLOSED';
    this.owner = 'NONE';

    return Promise.resolve();
  }
}

function replayContext(session: FakeSessionManager): CoordinatedRunContext<unknown> {
  return {
    runId: 'run-risky-handoff',
    mode: 'REPLAY',
    sessionManager: session as unknown as SessionManager,
  } as unknown as CoordinatedRunContext<unknown>;
}

function policy(): PolicyEngine {
  return new PolicyEngine({
    policyId: 'demo-banking-policy',
    version: 1,
    defaultDecision: 'DENY',

    allowedOrigins: ['http://127.0.0.1:3000', 'http://localhost:3000'],

    allowedRoutes: [
      {
        routeId: 'subaccount-commit',
        description: 'Sub-account commit route',
        match: {
          kind: 'exact',
          pathname: '/member/12345/subaccounts/commit',
        },
      },
      {
        routeId: 'member-pages',
        description: 'Member servicing routes',
        match: {
          kind: 'prefix',
          pathname: '/member/',
        },
      },
    ],

    allowedActions: ['click', 'read', 'wait', 'navigate', 'type', 'dismiss'],

    riskRules: [
      {
        ruleId: 'irreversible-subaccount-commit',
        description: 'Committing a sub-account requires human approval',
        match: {
          actions: ['click'],
          routeIds: ['subaccount-commit'],
        },
        riskLevel: 'IRREVERSIBLE',
        decision: 'REQUIRE_HUMAN',
      },
      {
        ruleId: 'reversible-member-actions',
        description: 'Reversible member actions are allowed',
        match: {
          actions: ['navigate', 'type', 'click'],
          routeIds: ['member-pages'],
        },
        riskLevel: 'REVERSIBLE',
        decision: 'ALLOW',
      },
    ],
  });
}

function confirmCreateStep(): CapabilityStep {
  return {
    id: 'confirm-create',

    description: 'Confirm Create Sub-Account',

    action: {
      kind: 'click',
    },

    risk: 'IRREVERSIBLE',

    target: {
      description: 'Confirm Create Sub-Account button',

      strategies: [
        {
          kind: 'role-name',
          role: 'button',
          name: {
            value: 'Confirm Create Sub-Account',
            mode: 'exact',
            caseSensitive: false,
          },
        },
      ],

      cardinality: 'exactly-one',
    },
  };
}

describe('risky irreversible action human handoff', () => {
  it('blocks the irreversible replay click before execution and hands the same live session to HUMAN', async () => {
    const step = confirmCreateStep();

    const gate = evaluateReplayPolicy({
      step,

      url: 'http://localhost:3000/member/12345/subaccounts/commit',

      policyEngine: policy(),
    });

    expect(gate).toMatchObject({
      status: 'intervention_required',

      intervention: {
        code: 'HUMAN_APPROVAL_REQUIRED',

        details: {
          stepId: 'confirm-create',
          actionKind: 'click',
          storedRisk: 'IRREVERSIBLE',
          effectiveRisk: 'IRREVERSIBLE',
          matchedRuleId: 'irreversible-subaccount-commit',
        },
      },
    });

    const automatedCommit = vi.fn(() =>
      Promise.resolve({
        clicked: true,
      }),
    );

    const execution = await executePolicyAuthorizedReplayAction({
      stepId: step.id,

      decision: {
        decision: 'REQUIRE_HUMAN',
        code: 'HUMAN_APPROVAL_REQUIRED',
        riskLevel: 'IRREVERSIBLE',
      },

      executeAction: automatedCommit,
    });

    expect(execution.status).toBe('intervention_required');

    /*
     * Critical 5.13 invariant:
     * automation never clicks the irreversible control.
     */
    expect(automatedCommit).not.toHaveBeenCalled();

    const manager = new InterventionManager({
      store: new InMemoryInterventionStore(),

      auditEventId: (() => {
        let id = 0;

        return () => `audit-${++id}`;
      })(),
    });

    const registry = new LiveInterventionRegistry();

    const controller = new InterventionController(manager, registry);

    const session = new FakeSessionManager();

    const context = replayContext(session);

    await controller.createAndPause({
      id: 'intervention-confirm-create',

      context,

      source: 'REPLAY',

      capabilityId: 'prepare_new_savings_subaccount',

      capabilityVersion: '1.0.0',

      stepId: 'confirm-create',

      reasonCode: 'HUMAN_APPROVAL_REQUIRED',

      reason: 'Confirm Create Sub-Account is irreversible and requires human approval.',

      observedState: 'Sub-account review screen with final confirmation available.',

      evidenceRefs: [],
    });

    expect(session.state).toBe('PAUSED');

    /*
     * Automation still owns the paused session until
     * an operator explicitly acquires it.
     */
    expect(session.owner).toBe('REPLAY');

    expect(registry.has('intervention-confirm-create')).toBe(true);

    await controller.acquireHumanControl({
      interventionId: 'intervention-confirm-create',

      context,

      acquisitionId: 'acquisition-confirm-create',

      operatorId: 'operator-1',
    });

    expect(session.state).toBe('PAUSED');

    expect(session.owner).toBe('HUMAN');

    /*
     * Still zero automated final commits after HUMAN takeover.
     */
    expect(automatedCommit).not.toHaveBeenCalled();

    const stored = await manager.get('intervention-confirm-create');

    expect(stored.request).toMatchObject({
      source: 'REPLAY',

      capabilityId: 'prepare_new_savings_subaccount',

      stepId: 'confirm-create',

      reasonCode: 'HUMAN_APPROVAL_REQUIRED',

      status: 'ACQUIRED',
    });

    expect(stored.auditTrail.map((event) => event.type)).toEqual([
      'intervention.created',
      'human.acquire_requested',
      'human.control_acquired',
    ]);
  });

  it('allows the human to choose resume only after a manual resolution is recorded', async () => {
    const manager = new InterventionManager({
      store: new InMemoryInterventionStore(),
    });

    const registry = new LiveInterventionRegistry();

    const controller = new InterventionController(manager, registry);

    const session = new FakeSessionManager();

    const context = replayContext(session);

    await controller.createAndPause({
      id: 'intervention-resume-choice',

      context,

      source: 'REPLAY',

      capabilityId: 'prepare_new_savings_subaccount',

      capabilityVersion: '1.0.0',

      stepId: 'confirm-create',

      reasonCode: 'HUMAN_APPROVAL_REQUIRED',

      reason: 'Final commit requires a human.',

      observedState: 'Sub-account review screen.',

      evidenceRefs: [],
    });

    await controller.acquireHumanControl({
      interventionId: 'intervention-resume-choice',

      context,

      acquisitionId: 'acquisition-resume-choice',

      operatorId: 'operator-1',
    });

    await controller.markHumanWorkInProgress('intervention-resume-choice');

    await controller.recordManualAction({
      interventionId: 'intervention-resume-choice',

      operatorId: 'operator-1',

      summary: 'Human confirmed the final Create Sub-Account action.',
    });

    const resolved = await controller.resumeAutomation({
      interventionId: 'intervention-resume-choice',

      context,

      operatorId: 'operator-1',
    });

    expect(resolved.status).toBe('RESOLVED');

    expect(session.state).toBe('ACTIVE');

    expect(session.owner).toBe('REPLAY');

    expect(session.closeCalls).toBe(0);

    const stored = await manager.get('intervention-resume-choice');

    expect(stored.auditTrail.map((event) => event.type)).toEqual([
      'intervention.created',
      'human.acquire_requested',
      'human.control_acquired',
      'human.action_performed',
      'human.resume_requested',
      'human.control_released',
      'automation.control_restored',
    ]);
  });

  it('allows the human to abort instead of restoring automation', async () => {
    const manager = new InterventionManager({
      store: new InMemoryInterventionStore(),
    });

    const registry = new LiveInterventionRegistry();

    const controller = new InterventionController(manager, registry);

    const session = new FakeSessionManager();

    const context = replayContext(session);

    await controller.createAndPause({
      id: 'intervention-abort-choice',

      context,

      source: 'REPLAY',

      capabilityId: 'prepare_new_savings_subaccount',

      capabilityVersion: '1.0.0',

      stepId: 'confirm-create',

      reasonCode: 'HUMAN_APPROVAL_REQUIRED',

      reason: 'Final commit requires a human.',

      observedState: 'Sub-account review screen.',

      evidenceRefs: [],
    });

    await controller.acquireHumanControl({
      interventionId: 'intervention-abort-choice',

      context,

      acquisitionId: 'acquisition-abort-choice',

      operatorId: 'operator-1',
    });

    const aborted = await controller.abortHumanIntervention({
      interventionId: 'intervention-abort-choice',

      context,

      operatorId: 'operator-1',
    });

    expect(aborted.status).toBe('ABORTED');

    expect(session.state).toBe('PAUSED');

    expect(session.owner).toBe('NONE');

    const stored = await manager.get('intervention-abort-choice');

    expect(stored.auditTrail.map((event) => event.type)).toEqual([
      'intervention.created',
      'human.acquire_requested',
      'human.control_acquired',
      'human.abort_requested',
      'human.control_released',
    ]);

    expect(stored.auditTrail.some((event) => event.type === 'automation.control_restored')).toBe(
      false,
    );
  });
});
