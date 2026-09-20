import type { CapturedEvidence, EvidenceReference, JsonValue } from '../surface/index.js';

export const REPLAY_EVIDENCE_EVENT_TYPES = [
  'replay.started',
  'artifact.loaded',
  'inputs.validated',
  'step.started',
  'policy.evaluated',
  'target.resolved',
  'precondition.passed',
  'action.completed',
  'output.extracted',
  'postcondition.passed',
  'business_outcome.detected',
  'recovery.started',
  'recovery.attempted',
  'recovery.succeeded',
  'recovery.exhausted',
  'success_condition.passed',
  'replay.completed',
  'replay.failed',
  'replay.intervention_required',
] as const;

export type ReplayEvidenceEventType = (typeof REPLAY_EVIDENCE_EVENT_TYPES)[number];

export interface ReplayEvidenceEvent {
  readonly eventType: ReplayEvidenceEventType;

  readonly step: number;

  readonly stepId?: string;

  readonly details: Readonly<Record<string, JsonValue>>;

  readonly evidenceRefs: readonly EvidenceReference[];
}

export interface ReplayEvidenceSink {
  /**
   * The concrete integration wires this to
   * EvidenceRecorder.recordEvent(...).
   *
   * Only sanitized structured data reaches this callback.
   */
  readonly recordEvent: (event: ReplayEvidenceEvent) => Promise<void>;

  /**
   * Raw CapturedEvidence is allowed only across this
   * persistence boundary.
   *
   * The concrete implementation must delegate to the
   * existing EvidenceRecorder sanitization/persistence path
   * and return the persisted EvidenceReference.
   */
  readonly persistCapturedEvidence: (
    evidence: CapturedEvidence,
    metadata: {
      readonly step: number;
      readonly stepId?: string;
      readonly purpose: string;
    },
  ) => Promise<EvidenceReference>;
}

const SENSITIVE_KEY_PATTERN =
  /(?:password|passwd|pwd|secret|token|cookie|authorization|api[-_]?key|access[-_]?key|session[-_]?token)/iu;

const SECRET_VALUE_PATTERNS = [
  /bearer\s+[a-z0-9._~+/=-]+/giu,
  /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password)\s*[:=]\s*["']?[^,\s"']+/giu,
];

const MAX_EVENT_STRING_LENGTH = 2_000;

function sanitizeString(value: string): string {
  let sanitized = value;

  for (const pattern of SECRET_VALUE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }

  if (sanitized.length > MAX_EVENT_STRING_LENGTH) {
    return sanitized.slice(0, MAX_EVENT_STRING_LENGTH);
  }

  return sanitized;
}

function sanitizeObject(value: Readonly<Record<string, JsonValue>>): Record<string, JsonValue> {
  const output: Record<string, JsonValue> = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = '[REDACTED]';

      continue;
    }

    output[key] = sanitizeReplayEvidenceValue(nestedValue);
  }

  return output;
}

/**
 * Persistence-facing replay sanitizer.
 *
 * This is intentionally conservative:
 *
 * - sensitive-looking keys are redacted;
 * - common credential/token values are redacted;
 * - arbitrary strings are bounded;
 * - undefined/functions/browser objects cannot enter because
 *   the input contract is JsonValue.
 */
export function sanitizeReplayEvidenceValue(value: JsonValue): JsonValue {
  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeReplayEvidenceValue);
  }

  return sanitizeObject(value);
}

export function sanitizeReplayEvidenceDetails(
  details: Readonly<Record<string, JsonValue>>,
): Readonly<Record<string, JsonValue>> {
  return Object.freeze(sanitizeObject(details));
}

export interface RecordReplayEvidenceInput {
  readonly sink: ReplayEvidenceSink;

  readonly eventType: ReplayEvidenceEventType;

  readonly step: number;

  readonly stepId?: string;

  readonly details?: Readonly<Record<string, JsonValue>>;

  readonly evidenceRefs?: readonly EvidenceReference[];
}

function assertStep(step: number): void {
  if (!Number.isInteger(step) || step < 0) {
    throw new Error('Replay evidence step must be a non-negative integer');
  }
}

/**
 * Single path for replay structured-event persistence.
 */
export async function recordReplayEvidence(input: RecordReplayEvidenceInput): Promise<void> {
  assertStep(input.step);

  await input.sink.recordEvent({
    eventType: input.eventType,

    step: input.step,

    ...(input.stepId === undefined
      ? {}
      : {
          stepId: sanitizeString(input.stepId),
        }),

    details: sanitizeReplayEvidenceDetails(input.details ?? {}),

    evidenceRefs: input.evidenceRefs ?? [],
  });
}
