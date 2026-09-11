import { randomUUID } from 'node:crypto';

import type { PolicyActionKind, PolicyDecision } from '../policy/index.js';

import type { RuntimeInterventionRequired } from '../runtime/index.js';

import type { DiscoveryDecision } from './decision.js';

export const DISCOVERY_ESCALATION_SOURCES = [
  'model',
  'policy',
  'repeated_state',
  'unsafe_ambiguity',
] as const;

export type DiscoveryEscalationSource = (typeof DISCOVERY_ESCALATION_SOURCES)[number];

export type ModelEscalationDecision = Extract<DiscoveryDecision, { readonly kind: 'escalate' }>;

export type HumanPolicyDecision = Extract<
  PolicyDecision,
  {
    readonly decision: 'REQUIRE_HUMAN';
  }
>;

interface EscalationTriggerBase {
  readonly goal: string;
  readonly step: number;
  readonly observationId: string;
  readonly location: string;
}

export type DiscoveryEscalationTrigger =
  | (EscalationTriggerBase & {
      readonly source: 'model';

      readonly decision: ModelEscalationDecision;
    })
  | (EscalationTriggerBase & {
      readonly source: 'policy';

      readonly policyDecision: HumanPolicyDecision;

      readonly actionKind: PolicyActionKind;
    })
  | (EscalationTriggerBase & {
      readonly source: 'repeated_state';

      readonly repeatedStateCount: number;

      readonly threshold: number;
    })
  | (EscalationTriggerBase & {
      readonly source: 'unsafe_ambiguity';

      readonly targetDescription: string;

      readonly resolutionAttempts: number;
    });

export type DiscoveryIntervention = RuntimeInterventionRequired['intervention'];

export interface CreateDiscoveryInterventionOptions {
  readonly createId?: () => string;
}

function requireNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${field} must not be empty`);
  }
}

function validateBase(trigger: EscalationTriggerBase): void {
  requireNonEmpty(trigger.goal, 'Escalation goal');

  requireNonEmpty(trigger.observationId, 'Escalation observationId');

  requireNonEmpty(trigger.location, 'Escalation location');

  if (!Number.isInteger(trigger.step) || trigger.step < 0) {
    throw new Error('Escalation step must be a non-negative integer');
  }
}

/**
 * Normalizes model and system-forced escalation
 * triggers into the existing runtime intervention
 * contract.
 *
 * The model is only one possible trigger source.
 * It cannot manufacture a policy decision.
 */
export function createDiscoveryIntervention(
  trigger: DiscoveryEscalationTrigger,
  options: CreateDiscoveryInterventionOptions = {},
): DiscoveryIntervention {
  validateBase(trigger);

  const createId = options.createId ?? randomUUID;

  const interventionId = createId();

  requireNonEmpty(interventionId, 'Intervention ID');

  const commonContext = {
    source: trigger.source,
    goal: trigger.goal,
    step: trigger.step,
    observationId: trigger.observationId,
    location: trigger.location,
  };

  switch (trigger.source) {
    case 'model':
      return Object.freeze({
        interventionId,

        code: trigger.decision.reasonCode,

        message: trigger.decision.reason,

        requestedOwner: 'HUMAN',

        /*
         * Full same-session handoff is not
         * implemented in Phase 2.
         */
        resumable: false,

        context: Object.freeze({
          ...commonContext,

          requestedBy: 'discovery_model',
        }),
      });

    case 'policy':
      return Object.freeze({
        interventionId,

        code: 'HUMAN_APPROVAL_REQUIRED',

        message: trigger.policyDecision.reason,

        requestedOwner: 'HUMAN',
        resumable: false,

        context: Object.freeze({
          ...commonContext,

          requestedBy: 'policy_engine',

          policyId: trigger.policyDecision.policyId,

          matchedRuleId: trigger.policyDecision.matchedRuleId,

          riskLevel: trigger.policyDecision.riskLevel,

          actionKind: trigger.actionKind,
        }),
      });

    case 'repeated_state': {
      if (!Number.isInteger(trigger.threshold) || trigger.threshold < 1) {
        throw new Error('Repeated-state threshold must be a positive integer');
      }

      if (
        !Number.isInteger(trigger.repeatedStateCount) ||
        trigger.repeatedStateCount < trigger.threshold
      ) {
        throw new Error(
          'Repeated-state escalation requires the configured threshold to be reached',
        );
      }

      return Object.freeze({
        interventionId,
        code: 'AUTOMATION_STUCK',

        message: 'Discovery repeated the same state without meaningful progress',

        requestedOwner: 'HUMAN',
        resumable: false,

        context: Object.freeze({
          ...commonContext,

          requestedBy: 'stuck_detector',

          repeatedStateCount: trigger.repeatedStateCount,

          threshold: trigger.threshold,
        }),
      });
    }

    case 'unsafe_ambiguity':
      requireNonEmpty(trigger.targetDescription, 'Ambiguous target description');

      if (!Number.isInteger(trigger.resolutionAttempts) || trigger.resolutionAttempts < 1) {
        throw new Error('Resolution attempts must be a positive integer');
      }

      return Object.freeze({
        interventionId,
        code: 'AUTOMATION_STUCK',

        message: 'Unable to identify a unique target safely',

        requestedOwner: 'HUMAN',
        resumable: false,

        context: Object.freeze({
          ...commonContext,

          requestedBy: 'target_resolver',

          targetDescription: trigger.targetDescription,

          resolutionAttempts: trigger.resolutionAttempts,

          failureCode: 'TARGET_AMBIGUOUS',
        }),
      });
  }
}
