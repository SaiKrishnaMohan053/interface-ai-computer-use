import type { InterventionStatus } from './intervention-types.js';

export type InterventionErrorCode =
  | 'INVALID_INTERVENTION'
  | 'INTERVENTION_NOT_FOUND'
  | 'INVALID_INTERVENTION_TRANSITION'
  | 'INTERVENTION_ALREADY_TERMINAL'
  | 'INTERVENTION_RESOLUTION_INVALID';

export class InterventionError extends Error {
  constructor(
    readonly code: InterventionErrorCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);

    this.name = 'InterventionError';
  }
}

export class InvalidInterventionTransitionError extends InterventionError {
  constructor(from: InterventionStatus, to: InterventionStatus) {
    super(
      'INVALID_INTERVENTION_TRANSITION',
      `Invalid intervention transition from ${from} to ${to}`,
      {
        from,
        to,
      },
    );

    this.name = 'InvalidInterventionTransitionError';
  }
}

export class InterventionNotFoundError extends InterventionError {
  constructor(interventionId: string) {
    super('INTERVENTION_NOT_FOUND', `Intervention not found: ${interventionId}`, {
      interventionId,
    });

    this.name = 'InterventionNotFoundError';
  }
}
