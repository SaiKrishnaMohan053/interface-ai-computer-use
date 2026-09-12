import { createHash } from 'node:crypto';

import type { AgentControl, AgentDialog, AgentObservation } from './agent-observation.js';

function normalizeText(value: string | null): string | null {
  return value === null ? null : value.replace(/\s+/g, ' ').trim();
}

function controlSignature(control: AgentControl): unknown {
  const base = {
    kind: control.kind,
    role: control.role,
    accessibleName: normalizeText(control.accessibleName),
    label: normalizeText(control.label),
    visibleText: normalizeText(control.visibleText),
    enabled: control.enabled,
    context: normalizeText(control.context),
  };

  switch (control.kind) {
    case 'link':
      return {
        ...base,
        destination: control.destination,
      };

    case 'text_input':
      return {
        ...base,
        inputType: control.inputType,
        value: normalizeText(control.value),
        readOnly: control.readOnly,
      };

    case 'select':
      return {
        ...base,
        multiple: control.multiple,
        options: control.options.map((option) => ({
          label: normalizeText(option.label),
          value: normalizeText(option.value),
          selected: option.selected,
          enabled: option.enabled,
        })),
      };

    case 'checkbox':
      return {
        ...base,
        checked: control.checked,
        indeterminate: control.indeterminate,
      };

    case 'radio':
      return {
        ...base,
        checked: control.checked,
      };

    case 'other':
      return {
        ...base,
        value: normalizeText(control.value),
      };

    case 'button':
      return base;
  }
}

function dialogSignature(dialog: AgentDialog): unknown {
  if (dialog.kind === 'native') {
    return {
      kind: dialog.kind,
      type: dialog.type,
      message: normalizeText(dialog.message),
      defaultValue: normalizeText(dialog.defaultValue),
    };
  }

  return {
    kind: dialog.kind,
    presentation: dialog.presentation,
    title: normalizeText(dialog.title),
    text: normalizeText(dialog.text),
    controlNames: dialog.controlNames.map((name) => normalizeText(name)),
  };
}

function sortedExtractedValues(observation: AgentObservation): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(observation.extractedValues).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

/**
 * Produces a deterministic signature of model-visible state.
 *
 * Volatile run metadata such as observation ID, timestamp, step, and recent
 * action outcomes is deliberately excluded.
 */
export function createDiscoveryObservationFingerprint(observation: AgentObservation): string {
  const location =
    observation.location.kind === 'web'
      ? {
          kind: 'web',
          url: observation.location.url,
          title: normalizeText(observation.location.title),
        }
      : {
          kind: 'application',
          applicationId: observation.location.applicationId,
          windowTitle: normalizeText(observation.location.windowTitle),
        };

  return createHash('sha256')
    .update(
      JSON.stringify({
        location,
        visibleText: normalizeText(observation.visibleTextSummary),
        controls: observation.controls.map(controlSignature),
        dialogs: observation.dialogs.map(dialogSignature),
        loading: observation.loading,
        extractedValues: sortedExtractedValues(observation),
      }),
    )
    .digest('hex');
}
