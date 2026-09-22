import type { InterventionManager } from './intervention-manager.js';

import type { InterventionRequest } from './intervention-types.js';

export interface InterventionExpiryCheckInput {
  readonly interventionId: string;

  readonly timeoutMs: number;

  readonly now?: string | undefined;
}

export type InterventionExpiryCheckResult =
  | {
      readonly status: 'expired';

      readonly intervention: InterventionRequest;

      readonly ageMs: number;
    }
  | {
      readonly status: 'not_expired';

      readonly intervention: InterventionRequest;

      readonly ageMs: number;
    }
  | {
      readonly status: 'not_applicable';

      readonly intervention: InterventionRequest;

      readonly reason: 'ALREADY_ACQUIRED' | 'TERMINAL_STATUS';
    };

function parseTimestamp(value: string, label: string): number {
  const parsed = Date.parse(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid timestamp`);
  }

  return parsed;
}

/**
 * Synchronous/on-demand intervention expiry check.
 *
 * No timer, scheduler, queue, or background worker is
 * created. Callers invoke this before human acquisition or
 * while inspecting waiting interventions.
 */
export async function expireInterventionIfTimedOut(
  manager: InterventionManager,
  input: InterventionExpiryCheckInput,
): Promise<InterventionExpiryCheckResult> {
  if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
    throw new Error('Intervention timeoutMs must be greater than zero');
  }

  const stored = await manager.get(input.interventionId);

  const request = stored.request;

  if (request.status === 'ACQUIRED' || request.status === 'IN_PROGRESS') {
    return {
      status: 'not_applicable',

      intervention: request,

      reason: 'ALREADY_ACQUIRED',
    };
  }

  if (
    request.status === 'RESOLVED' ||
    request.status === 'ABORTED' ||
    request.status === 'EXPIRED'
  ) {
    return {
      status: 'not_applicable',

      intervention: request,

      reason: 'TERMINAL_STATUS',
    };
  }

  if (request.status !== 'WAITING_FOR_HUMAN') {
    return {
      status: 'not_expired',

      intervention: request,

      ageMs: 0,
    };
  }

  const createdAtMs = parseTimestamp(request.createdAt, 'Intervention createdAt');

  const nowMs = parseTimestamp(input.now ?? new Date().toISOString(), 'Intervention expiry now');

  if (nowMs < createdAtMs) {
    throw new Error('Intervention expiry clock cannot precede createdAt');
  }

  const ageMs = nowMs - createdAtMs;

  if (ageMs < input.timeoutMs) {
    return {
      status: 'not_expired',

      intervention: request,

      ageMs,
    };
  }

  const expired = await manager.transition(input.interventionId, 'EXPIRED');

  return {
    status: 'expired',

    intervention: expired,

    ageMs,
  };
}
