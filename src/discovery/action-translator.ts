import type { ExecutableSurfaceAction, ResolvedTarget } from '../surface/index.js';

import type { AgentTargetSpec, DiscoveryDecision } from './decision.js';

export const TRANSLATABLE_DISCOVERY_DECISION_KINDS = [
  'click',
  'type',
  'select',
  'check',
  'uncheck',
  'navigate',
  'read',
  'dismiss',
] as const;

export type TranslatableDiscoveryDecision = Exclude<
  DiscoveryDecision,
  { readonly kind: 'wait' | 'complete' | 'escalate' }
>;

export type DiscoveryActionTranslationErrorCode =
  'MISSING_RESOLVED_TARGET' | 'UNEXPECTED_RESOLVED_TARGET' | 'UNSUPPORTED_DECISION';

export class DiscoveryActionTranslationError extends Error {
  constructor(
    readonly code: DiscoveryActionTranslationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DiscoveryActionTranslationError';
  }
}

export interface DiscoveryActionTranslationInput {
  readonly decision: TranslatableDiscoveryDecision;
  readonly resolvedTarget: ResolvedTarget | null;
}

/**
 * Returns the model-facing semantic target that must be resolved before
 * translation. Direct navigation and native-dialog dismissal require no
 * element target.
 */
export function getDiscoveryDecisionTarget(
  decision: TranslatableDiscoveryDecision,
): AgentTargetSpec | null {
  if (decision.kind === 'navigate') {
    return null;
  }

  if (decision.kind === 'dismiss') {
    return decision.dialog.kind === 'surface' ? decision.dialog.target : null;
  }

  return decision.target;
}

function requireTarget(
  decision: TranslatableDiscoveryDecision,
  resolvedTarget: ResolvedTarget | null,
): ResolvedTarget {
  if (resolvedTarget === null) {
    throw new DiscoveryActionTranslationError(
      'MISSING_RESOLVED_TARGET',
      `${decision.kind} requires an engine-resolved target`,
    );
  }

  return resolvedTarget;
}

function rejectUnexpectedTarget(resolvedTarget: ResolvedTarget | null): void {
  if (resolvedTarget !== null) {
    throw new DiscoveryActionTranslationError(
      'UNEXPECTED_RESOLVED_TARGET',
      'This decision must not receive a resolved element target',
    );
  }
}

/**
 * Converts a validated model-facing decision into the runtime surface action.
 *
 * The model supplies semantic intent only. The engine resolves the target and
 * this translator injects the opaque runtime handle. Model-only fields such as
 * reason and saveAs never cross the SurfaceAdapter boundary.
 */
export function translateDiscoveryDecision(
  input: DiscoveryActionTranslationInput,
): ExecutableSurfaceAction {
  const { decision, resolvedTarget } = input;

  switch (decision.kind) {
    case 'click':
      return {
        kind: 'click',
        target: requireTarget(decision, resolvedTarget),
      };

    case 'type':
      return {
        kind: 'type',
        target: requireTarget(decision, resolvedTarget),
        text: decision.text,
        mode: decision.mode,
      };

    case 'select':
      return {
        kind: 'select',
        target: requireTarget(decision, resolvedTarget),
        option: decision.option,
      };

    case 'check':
      return {
        kind: 'check',
        target: requireTarget(decision, resolvedTarget),
      };

    case 'uncheck':
      return {
        kind: 'uncheck',
        target: requireTarget(decision, resolvedTarget),
      };

    case 'navigate':
      rejectUnexpectedTarget(resolvedTarget);

      return {
        kind: 'navigate',
        destination: decision.destination,
      };

    case 'read':
      return {
        kind: 'read',
        target: requireTarget(decision, resolvedTarget),
        source: decision.source,
      };

    case 'dismiss':
      if (decision.dialog.kind === 'surface') {
        return {
          kind: 'dismiss',
          dialog: {
            kind: 'surface',
            target: requireTarget(decision, resolvedTarget),
          },
        };
      }

      rejectUnexpectedTarget(resolvedTarget);

      return {
        kind: 'dismiss',
        dialog: {
          kind: 'native',
          observationId: decision.dialog.observationId,
          dialogId: decision.dialog.dialogId,
          response:
            decision.dialog.response.kind === 'dismiss'
              ? { kind: 'dismiss' }
              : decision.dialog.response.promptText === undefined
                ? { kind: 'accept' }
                : {
                    kind: 'accept',
                    promptText: decision.dialog.response.promptText,
                  },
        },
      };

    default:
      throw new DiscoveryActionTranslationError(
        'UNSUPPORTED_DECISION',
        'Decision cannot be translated into an executable surface action',
      );
  }
}
