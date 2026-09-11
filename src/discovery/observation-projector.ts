import {
  agentActionOutcomeSchema,
  agentConditionOutcomeSchema,
  agentErrorSchema,
  agentObservationSchema,
} from './agent-observation.js';

import type {
  AgentActionOutcome,
  AgentConditionOutcome,
  AgentControl,
  AgentDialog,
  AgentError,
  AgentObservation,
} from './agent-observation.js';

import type { JsonValue, ObservableControl, SurfaceObservation } from '../surface/contracts.js';

export const MODEL_CONTEXT_REDACTED_VALUE = '[REDACTED]';

const MAX_GOAL_LENGTH = 4_000;
const MAX_VISIBLE_TEXT_LENGTH = 20_000;
const MAX_FIELD_LENGTH = 2_000;
const MAX_IDENTIFIER_LENGTH = 500;
const MAX_ROLE_LENGTH = 200;
const MAX_CONTROLS = 200;
const MAX_DIALOGS = 20;
const MAX_OPTIONS = 200;
const MAX_CONTEXT_HINTS = 20;
const MAX_SANITIZATION_DEPTH = 30;

const blockedModelContextKeys = new Set([
  'password',
  'passwd',
  'pwd',
  'apikey',
  'authorization',
  'proxyauthorization',
  'cookie',
  'cookies',
  'setcookie',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'authtoken',
  'bearertoken',
  'sessiontoken',
  'clientsecret',
  'sessionid',
  'surfaceid',
  'sessionstate',
  'storagestate',
  'browsercontext',
  'browser',
  'playwright',
  'page',
  'locator',
  'handle',
  'rawdom',
  'dom',
  'headers',
]);

export interface ModelContextProjectionPolicy {
  readonly maxVisibleTextLength?: number;
  readonly maxControls?: number;
  readonly maxDialogs?: number;
  readonly maxOptionsPerControl?: number;
}

export interface ObservationProjectionContextHints {
  readonly frames?: readonly string[];
  readonly regions?: readonly string[];
}

export interface ObservationProjectionInput {
  readonly goal: string;
  readonly step: number;
  readonly observation: SurfaceObservation;

  readonly extractedValues?: Readonly<Record<string, JsonValue>>;
  readonly recentAction?: AgentActionOutcome | null;
  readonly recentCondition?: AgentConditionOutcome | null;
  readonly recentError?: AgentError | null;

  readonly contextHints?: ObservationProjectionContextHints;

  /**
   * Optional semantic context keyed by observation-local controlId.
   * The IDs are consumed internally and never exposed to the model.
   */
  readonly controlContexts?: Readonly<Record<string, string>>;

  readonly policy?: ModelContextProjectionPolicy;
}

interface ResolvedProjectionPolicy {
  readonly maxVisibleTextLength: number;
  readonly maxControls: number;
  readonly maxDialogs: number;
  readonly maxOptionsPerControl: number;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isBlockedModelContextKey(key: string): boolean {
  const normalized = normalizeKey(key);

  return (
    blockedModelContextKeys.has(normalized) ||
    normalized.endsWith('password') ||
    normalized.endsWith('apikey') ||
    normalized.endsWith('token') ||
    normalized.endsWith('authorization') ||
    normalized.endsWith('cookie') ||
    normalized.endsWith('secret')
  );
}

function sanitizeString(value: string): string {
  return value
    .replace(
      /([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|token|password)=)[^&#\s]*/gi,
      `$1${MODEL_CONTEXT_REDACTED_VALUE}`,
    )
    .replace(
      /(\b(?:authorization|proxy-authorization)\s*[:=]\s*)(?:bearer\s+|basic\s+)?[^\s,;]+/gi,
      `$1${MODEL_CONTEXT_REDACTED_VALUE}`,
    )
    .replace(/(\b(?:cookie|set-cookie)\s*[:=]\s*)[^\r\n]+/gi, `$1${MODEL_CONTEXT_REDACTED_VALUE}`)
    .replace(
      /(\b(?:password|passwd|pwd|api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret)\s*[:=]\s*)[^\s,;&]+/gi,
      `$1${MODEL_CONTEXT_REDACTED_VALUE}`,
    )
    .replace(/\bsk-[a-z0-9_-]{8,}\b/gi, MODEL_CONTEXT_REDACTED_VALUE)
    .replace(/\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/gi, MODEL_CONTEXT_REDACTED_VALUE);
}

function sanitizeUnknownValue(input: unknown, active: WeakSet<object>, depth: number): JsonValue {
  if (depth > MAX_SANITIZATION_DEPTH) {
    return '[MAX_DEPTH]';
  }

  if (input === null) {
    return null;
  }

  switch (typeof input) {
    case 'string':
      return sanitizeString(input);

    case 'boolean':
      return input;

    case 'number':
      return Number.isFinite(input) ? input : null;

    case 'bigint':
      return input.toString();

    case 'undefined':
    case 'function':
    case 'symbol':
      return null;
  }

  if (input instanceof Date) {
    return input.toISOString();
  }

  if (active.has(input)) {
    return '[CIRCULAR]';
  }

  active.add(input);

  try {
    if (Array.isArray(input)) {
      return input.map((value) => sanitizeUnknownValue(value, active, depth + 1));
    }

    const output: Record<string, JsonValue> = {};

    for (const [key, value] of Object.entries(input)) {
      if (isBlockedModelContextKey(key)) {
        continue;
      }

      output[key] = sanitizeUnknownValue(value, active, depth + 1);
    }

    return output;
  } finally {
    active.delete(input);
  }
}

/**
 * Sanitizes values intended for transient model context.
 *
 * This is intentionally distinct from persistence redaction. Fake member IDs,
 * names, account labels, and balances may remain available to the model when
 * they are required to solve the discovery goal.
 */
export function sanitizeModelContextValue(input: unknown): JsonValue {
  return sanitizeUnknownValue(input, new WeakSet<object>(), 0);
}

function truncate(value: string, maximum: number): string {
  if (value.length <= maximum) {
    return value;
  }

  return value.slice(0, maximum);
}

function sanitizeAndTruncate(value: string, maximum: number): string {
  return truncate(sanitizeString(value), maximum);
}

function sanitizeNullableText(value: string | null, maximum = MAX_FIELD_LENGTH): string | null {
  return value === null ? null : sanitizeAndTruncate(value, maximum);
}

function compactVisibleText(value: string): string {
  const lines = sanitizeString(value)
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0);

  const deduplicated: string[] = [];

  for (const line of lines) {
    if (deduplicated.at(-1) !== line) {
      deduplicated.push(line);
    }
  }

  return deduplicated.join('\n');
}

function resolveLimit(
  value: number | undefined,
  fallback: number,
  maximum: number,
  field: string,
): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new RangeError(`${field} must be a positive integer no greater than ${maximum}`);
  }

  return value;
}

function resolvePolicy(policy: ModelContextProjectionPolicy | undefined): ResolvedProjectionPolicy {
  return {
    maxVisibleTextLength: resolveLimit(
      policy?.maxVisibleTextLength,
      MAX_VISIBLE_TEXT_LENGTH,
      MAX_VISIBLE_TEXT_LENGTH,
      'maxVisibleTextLength',
    ),
    maxControls: resolveLimit(policy?.maxControls, MAX_CONTROLS, MAX_CONTROLS, 'maxControls'),
    maxDialogs: resolveLimit(policy?.maxDialogs, MAX_DIALOGS, MAX_DIALOGS, 'maxDialogs'),
    maxOptionsPerControl: resolveLimit(
      policy?.maxOptionsPerControl,
      MAX_OPTIONS,
      MAX_OPTIONS,
      'maxOptionsPerControl',
    ),
  };
}

function sanitizeUrl(urlValue: string): string {
  const url = new URL(urlValue);

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('Model-facing locations require HTTP or HTTPS URLs');
  }

  url.username = '';
  url.password = '';
  url.hash = '';

  for (const key of [...url.searchParams.keys()]) {
    if (isBlockedModelContextKey(key)) {
      url.searchParams.delete(key);
    }
  }

  return truncate(url.toString(), MAX_FIELD_LENGTH);
}

function sanitizeLinkDestination(destination: string | null): string | null {
  if (destination === null) {
    return null;
  }

  const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(destination);

  try {
    const url = new URL(destination, 'https://model-context.invalid');

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    url.username = '';
    url.password = '';
    url.hash = '';

    for (const key of [...url.searchParams.keys()]) {
      if (isBlockedModelContextKey(key)) {
        url.searchParams.delete(key);
      }
    }

    if (!isAbsolute) {
      return truncate(`${url.pathname}${url.search}`, MAX_FIELD_LENGTH);
    }

    return truncate(url.toString(), MAX_FIELD_LENGTH);
  } catch {
    return sanitizeNullableText(destination);
  }
}

function controlCommonFields(control: ObservableControl, context: string | undefined) {
  return {
    role: control.role === null ? null : sanitizeAndTruncate(control.role, MAX_ROLE_LENGTH),
    accessibleName: sanitizeAndTruncate(control.name, MAX_FIELD_LENGTH),
    enabled: control.enabled,
    context: context === undefined ? null : sanitizeAndTruncate(context, MAX_FIELD_LENGTH),
  };
}

function projectControl(
  control: ObservableControl,
  context: string | undefined,
  maxOptions: number,
): AgentControl {
  const common = controlCommonFields(control, context);
  const semanticName = common.accessibleName.length > 0 ? common.accessibleName : null;

  switch (control.kind) {
    case 'button':
      return {
        ...common,
        kind: 'button',
        label: null,
        visibleText: semanticName,
      };

    case 'link':
      return {
        ...common,
        kind: 'link',
        label: null,
        visibleText: semanticName,
        destination: sanitizeLinkDestination(control.destination),
      };

    case 'text_input':
      return {
        ...common,
        kind: 'text_input',
        label: semanticName,
        visibleText: null,
        inputType: control.inputType,
        value: control.inputType === 'password' ? null : sanitizeNullableText(control.value),
        readOnly: control.readOnly,
      };

    case 'select':
      return {
        ...common,
        kind: 'select',
        label: semanticName,
        visibleText: null,
        multiple: control.multiple,
        options: control.options.slice(0, maxOptions).map((option) => ({
          label: sanitizeAndTruncate(option.label, MAX_FIELD_LENGTH),
          value: sanitizeAndTruncate(option.value, MAX_FIELD_LENGTH),
          selected: option.selected,
          enabled: option.enabled,
        })),
      };

    case 'checkbox':
      return {
        ...common,
        kind: 'checkbox',
        label: semanticName,
        visibleText: null,
        checked: control.checked,
        indeterminate: control.indeterminate,
      };

    case 'radio':
      return {
        ...common,
        kind: 'radio',
        label: semanticName,
        visibleText: null,
        checked: control.checked,
      };

    case 'other':
      return {
        ...common,
        kind: 'other',
        label: null,
        visibleText: semanticName,
        value: sanitizeNullableText(control.value),
      };
  }
}

function projectDialogs(
  observation: SurfaceObservation,
  controlNames: ReadonlyMap<string, string>,
  maximum: number,
): AgentDialog[] {
  return observation.dialogs.slice(0, maximum).map((dialog) => {
    if (dialog.kind === 'native') {
      return {
        kind: 'native',
        dialogId: truncate(dialog.dialogId, MAX_IDENTIFIER_LENGTH),
        type: dialog.type,
        message: sanitizeAndTruncate(dialog.message, MAX_FIELD_LENGTH),
        defaultValue: sanitizeNullableText(dialog.defaultValue),
      };
    }

    return {
      kind: 'surface',
      dialogId: truncate(dialog.dialogId, MAX_IDENTIFIER_LENGTH),
      presentation: dialog.presentation,
      title: sanitizeNullableText(dialog.title),
      text: sanitizeAndTruncate(dialog.text, MAX_VISIBLE_TEXT_LENGTH),
      controlNames: dialog.controlIds.flatMap((controlId) => {
        const name = controlNames.get(controlId);

        return name && name.length > 0 ? [name] : [];
      }),
    };
  });
}

function projectContextHints(hints: ObservationProjectionContextHints | undefined) {
  const sanitizeHints = (values: readonly string[] | undefined): string[] => {
    const unique = new Set<string>();

    for (const value of values ?? []) {
      const sanitized = sanitizeAndTruncate(value, MAX_FIELD_LENGTH);

      if (sanitized.length > 0) {
        unique.add(sanitized);
      }

      if (unique.size >= MAX_CONTEXT_HINTS) {
        break;
      }
    }

    return [...unique];
  };

  return {
    frames: sanitizeHints(hints?.frames),
    regions: sanitizeHints(hints?.regions),
  };
}

function projectExtractedValues(
  values: Readonly<Record<string, JsonValue>> | undefined,
): Record<string, JsonValue> {
  const output: Record<string, JsonValue> = {};

  for (const [key, value] of Object.entries(values ?? {})) {
    if (isBlockedModelContextKey(key)) {
      continue;
    }

    const safeKey = truncate(key, MAX_IDENTIFIER_LENGTH);

    if (safeKey.length === 0) {
      continue;
    }

    output[safeKey] = sanitizeModelContextValue(value);
  }

  return output;
}

function projectRecentAction(
  outcome: AgentActionOutcome | null | undefined,
): AgentActionOutcome | null {
  if (outcome == null) {
    return null;
  }

  if (outcome.status === 'success') {
    return agentActionOutcomeSchema.parse({
      status: 'success',
      actionKind: outcome.actionKind,
      summary: sanitizeAndTruncate(outcome.summary, MAX_FIELD_LENGTH),
      output: sanitizeModelContextValue(outcome.output),
    });
  }

  return agentActionOutcomeSchema.parse({
    status: 'failure',
    actionKind: outcome.actionKind,
    summary: sanitizeAndTruncate(outcome.summary, MAX_FIELD_LENGTH),
    errorCode: sanitizeAndTruncate(outcome.errorCode, MAX_ROLE_LENGTH),
    recoverable: outcome.recoverable,
  });
}

function projectRecentCondition(
  outcome: AgentConditionOutcome | null | undefined,
): AgentConditionOutcome | null {
  if (outcome == null) {
    return null;
  }

  return agentConditionOutcomeSchema.parse({
    status: outcome.status,
    conditionKind: sanitizeAndTruncate(outcome.conditionKind, MAX_ROLE_LENGTH),
    summary: sanitizeAndTruncate(outcome.summary, MAX_FIELD_LENGTH),
  });
}

function projectRecentError(error: AgentError | null | undefined): AgentError | null {
  if (error == null) {
    return null;
  }

  return agentErrorSchema.parse({
    code: sanitizeAndTruncate(error.code, MAX_ROLE_LENGTH),
    message: sanitizeAndTruncate(error.message, MAX_FIELD_LENGTH),
    recoverable: error.recoverable,
  });
}

export function projectObservationForAgent(input: ObservationProjectionInput): AgentObservation {
  const policy = resolvePolicy(input.policy);
  const compactedText = compactVisibleText(input.observation.visibleText);
  const visibleTextSummary = truncate(compactedText, policy.maxVisibleTextLength);

  const visibleControls = input.observation.controls.filter((control) => control.visible);

  const selectedControls = visibleControls.slice(0, policy.maxControls);

  const controls = selectedControls.map((control) =>
    projectControl(
      control,
      input.controlContexts?.[control.controlId],
      policy.maxOptionsPerControl,
    ),
  );

  const controlNames = new Map<string, string>();

  selectedControls.forEach((control, index) => {
    controlNames.set(control.controlId, controls[index]?.accessibleName ?? '');
  });

  const location =
    input.observation.location.kind === 'web'
      ? {
          kind: 'web' as const,
          url: sanitizeUrl(input.observation.location.url),
          title: sanitizeAndTruncate(input.observation.location.title, MAX_FIELD_LENGTH),
        }
      : {
          kind: 'application' as const,
          applicationId: sanitizeAndTruncate(
            input.observation.location.applicationId,
            MAX_FIELD_LENGTH,
          ),
          windowTitle: sanitizeAndTruncate(
            input.observation.location.windowTitle,
            MAX_FIELD_LENGTH,
          ),
        };

  return agentObservationSchema.parse({
    goal: sanitizeAndTruncate(input.goal, MAX_GOAL_LENGTH),
    step: input.step,

    observationId: truncate(input.observation.observationId, MAX_IDENTIFIER_LENGTH),
    capturedAt: input.observation.capturedAt,

    location,
    visibleTextSummary,
    controls,
    dialogs: projectDialogs(input.observation, controlNames, policy.maxDialogs),

    contextHints: projectContextHints(input.contextHints),

    loading: input.observation.loading,

    truncated: {
      visibleText:
        input.observation.truncated.visibleText ||
        compactedText.length > policy.maxVisibleTextLength,
      controls: input.observation.truncated.controls || visibleControls.length > policy.maxControls,
    },

    extractedValues: projectExtractedValues(input.extractedValues),

    recentAction: projectRecentAction(input.recentAction),
    recentCondition: projectRecentCondition(input.recentCondition),
    recentError: projectRecentError(input.recentError),
  });
}
