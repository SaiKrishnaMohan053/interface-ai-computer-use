import type { RiskLevel } from '../policy/index.js';

import type { ActionableDiscoveryDecision } from './discovery-policy-gate.js';

export interface DiscoveryRiskClassification {
  readonly riskLevel: RiskLevel;
  readonly source: 'system';
  readonly rationale: string;
}

const irreversibleTargetPattern =
  /\b(submit|create|finalize|confirm|place order|send payment|transfer funds|complete transaction)\b/i;

const readOnlyTargetPattern =
  /\b(search|find|view|open|details?|accounts?|members?|balances?|next|back)\b/i;

const sensitiveInputPattern =
  /\b(password|passcode|pin|ssn|social security|routing|account number|card number|secret|credential)\b/i;

function targetSemantics(decision: ActionableDiscoveryDecision): string {
  if (decision.kind === 'navigate' || decision.kind === 'wait') {
    return '';
  }

  if (decision.kind === 'dismiss') {
    return decision.dialog.kind === 'surface'
      ? JSON.stringify(decision.dialog.target.strategies)
      : '';
  }

  /*
   * Target descriptions are model-written rationale and
   * are not authoritative risk evidence.
   *
   * Semantic strategies must later resolve against the
   * observed surface, so they are the trusted input here.
   */
  return JSON.stringify(decision.target.strategies);
}

/**
 * Derives the minimum trusted risk for a validated discovery decision.
 * Model-provided reason text is deliberately excluded from classification.
 */
export function classifyDiscoveryDecisionRisk(
  decision: ActionableDiscoveryDecision,
): DiscoveryRiskClassification {
  switch (decision.kind) {
    case 'read':
    case 'navigate':
    case 'wait':
      return Object.freeze({
        riskLevel: 'READ_ONLY',
        source: 'system',
        rationale: `${decision.kind} does not modify application state`,
      });

    case 'type':
      return sensitiveInputPattern.test(targetSemantics(decision))
        ? Object.freeze({
            riskLevel: 'SENSITIVE_WRITE',
            source: 'system',
            rationale: 'Typing targets a field with sensitive-data semantics',
          })
        : Object.freeze({
            riskLevel: 'REVERSIBLE',
            source: 'system',
            rationale: 'Form typing before submission is reversible',
          });

    case 'click': {
      const semantics = targetSemantics(decision);

      if (irreversibleTargetPattern.test(semantics)) {
        return Object.freeze({
          riskLevel: 'IRREVERSIBLE',
          source: 'system',
          rationale: 'The target has final create, confirm, or submit semantics',
        });
      }

      if (readOnlyTargetPattern.test(semantics)) {
        return Object.freeze({
          riskLevel: 'READ_ONLY',
          source: 'system',
          rationale: 'The target has search, navigation, or inspection semantics',
        });
      }

      return Object.freeze({
        riskLevel: 'REVERSIBLE',
        source: 'system',
        rationale: 'The click may change reversible interface state',
      });
    }

    case 'select':
    case 'check':
    case 'uncheck':
    case 'dismiss':
      return Object.freeze({
        riskLevel: 'REVERSIBLE',
        source: 'system',
        rationale: `${decision.kind} may change reversible interface state`,
      });
  }
}
