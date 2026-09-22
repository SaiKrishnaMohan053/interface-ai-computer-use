import { InvalidInterventionTransitionError, InterventionError } from './intervention-errors.js';

import type { InterventionStatus } from './intervention-types.js';

export const TERMINAL_INTERVENTION_STATUSES = [
  'RESOLVED',
  'ABORTED',
  'EXPIRED',
] as const satisfies readonly InterventionStatus[];

export type TerminalInterventionStatus = (typeof TERMINAL_INTERVENTION_STATUSES)[number];

const VALID_TRANSITIONS = {
  REQUESTED: ['WAITING_FOR_HUMAN', 'ABORTED', 'EXPIRED'],

  WAITING_FOR_HUMAN: ['ACQUIRED', 'ABORTED', 'EXPIRED'],

  ACQUIRED: ['IN_PROGRESS', 'RESOLVED', 'ABORTED'],

  IN_PROGRESS: ['RESOLVED', 'ABORTED'],

  RESOLVED: [],

  ABORTED: [],

  EXPIRED: [],
} as const satisfies Readonly<Record<InterventionStatus, readonly InterventionStatus[]>>;

export function isTerminalInterventionStatus(
  status: InterventionStatus,
): status is TerminalInterventionStatus {
  return status === 'RESOLVED' || status === 'ABORTED' || status === 'EXPIRED';
}

export function allowedInterventionTransitions(
  status: InterventionStatus,
): readonly InterventionStatus[] {
  return VALID_TRANSITIONS[status];
}

export function canTransitionIntervention(
  from: InterventionStatus,
  to: InterventionStatus,
): boolean {
  const allowed: readonly InterventionStatus[] = VALID_TRANSITIONS[from];

  return allowed.includes(to);
}

export function assertInterventionTransition(
  from: InterventionStatus,
  to: InterventionStatus,
): void {
  if (isTerminalInterventionStatus(from)) {
    throw new InterventionError(
      'INTERVENTION_ALREADY_TERMINAL',
      `Intervention in ${from} state cannot transition`,
      {
        from,
        requestedStatus: to,
      },
    );
  }

  if (!canTransitionIntervention(from, to)) {
    throw new InvalidInterventionTransitionError(from, to);
  }
}
