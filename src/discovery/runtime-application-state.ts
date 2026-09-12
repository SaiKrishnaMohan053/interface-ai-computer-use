import type { AgentDialog, AgentObservation } from './agent-observation.js';

export const KNOWN_SAFE_DEMO_DIALOG_TITLE = 'Scheduled Service Notice';

export type DiscoveryApplicationState =
  | { readonly kind: 'ready' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'permission_denied'; readonly message: string }
  | { readonly kind: 'session_expired'; readonly message: string }
  | { readonly kind: 'application_error'; readonly message: string }
  | { readonly kind: 'known_safe_dialog'; readonly dialog: AgentDialog }
  | { readonly kind: 'unsafe_dialog'; readonly dialog: AgentDialog };

function normalized(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function pageStateCode(observation: AgentObservation): string {
  const title =
    observation.location.kind === 'web'
      ? observation.location.title
      : observation.location.windowTitle;

  return normalized(title).split('|')[0]?.trim().toUpperCase() ?? '';
}

function isKnownSafeDemoDialog(dialog: AgentDialog): boolean {
  return (
    dialog.kind === 'surface' &&
    dialog.presentation === 'interstitial' &&
    normalized(dialog.title ?? '') === KNOWN_SAFE_DEMO_DIALOG_TITLE &&
    normalized(dialog.text).includes('known demonstration notice') &&
    dialog.controlNames.some((name) => normalized(name) === 'Continue')
  );
}

/**
 * Classifies application states deterministically without asking the model.
 */
export function detectDiscoveryApplicationState(
  observation: AgentObservation,
): DiscoveryApplicationState {
  const code = pageStateCode(observation);

  if (code === 'PERMISSION_DENIED') {
    return {
      kind: 'permission_denied',
      message: 'Access to the requested member is restricted',
    };
  }

  if (code === 'SESSION_EXPIRED') {
    return {
      kind: 'session_expired',
      message: 'The application session expired during discovery',
    };
  }

  if (code === 'APPLICATION_ERROR') {
    return {
      kind: 'application_error',
      message: 'The application reported an error during discovery',
    };
  }

  if (observation.loading === 'loading') {
    return { kind: 'loading' };
  }

  const unsafeDialog = observation.dialogs.find((dialog) => !isKnownSafeDemoDialog(dialog));

  if (unsafeDialog !== undefined) {
    return { kind: 'unsafe_dialog', dialog: unsafeDialog };
  }

  const safeDialog = observation.dialogs.find(isKnownSafeDemoDialog);

  if (safeDialog !== undefined) {
    return { kind: 'known_safe_dialog', dialog: safeDialog };
  }

  return { kind: 'ready' };
}
