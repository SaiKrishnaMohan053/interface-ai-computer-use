import type { CapabilityStep } from '../artifact/index.js';

import type { RiskLevel } from '../policy/index.js';

const RISK_RANK: Readonly<Record<RiskLevel, number>> = {
  READ_ONLY: 0,
  REVERSIBLE: 1,
  SENSITIVE_WRITE: 2,
  IRREVERSIBLE: 3,
};

/**
 * Deterministic runtime classification of persisted capability actions.
 *
 * This classification is trusted runtime logic.
 * Artifact-provided risk metadata is never treated as authoritative.
 */
export function classifyReplayStepRisk(step: Pick<CapabilityStep, 'action'>): RiskLevel {
  switch (step.action.kind) {
    case 'read':
    case 'wait':
    case 'navigate':
    case 'click':
      return 'READ_ONLY';

    case 'type':
    case 'select':
    case 'check':
    case 'uncheck':
    case 'dismiss':
      return 'REVERSIBLE';
  }
}

export function compareReplayRisk(left: RiskLevel, right: RiskLevel): number {
  return RISK_RANK[left] - RISK_RANK[right];
}

export function maxReplayRisk(left: RiskLevel, right: RiskLevel): RiskLevel {
  return compareReplayRisk(left, right) >= 0 ? left : right;
}
