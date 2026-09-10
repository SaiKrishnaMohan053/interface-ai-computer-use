import { writeFile } from 'node:fs/promises';
import type { JsonValue } from '../surface/contracts.js';

export const REDACTED_VALUE = '[REDACTED]';
export const CIRCULAR_VALUE = '[CIRCULAR]';
export const MAX_SANITIZATION_DEPTH = 50;

const sensitiveKeys = new Set([
  'password',
  'passwd',
  'pwd',
  'apikey',
  'authorization',
  'proxyauthorization',
  'cookie',
  'setcookie',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'authtoken',
  'bearertoken',
  'sessiontoken',
  'clientsecret',
  'memberid',
  'membernumber',
]);

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, '');

export function isSensitiveKey(key: string): boolean {
  const normalized = normalizeKey(key);

  return (
    sensitiveKeys.has(normalized) ||
    normalized.endsWith('password') ||
    normalized.endsWith('apikey') ||
    normalized.endsWith('token') ||
    normalized.endsWith('authorization') ||
    normalized.endsWith('cookie') ||
    normalized.endsWith('secret') ||
    normalized.endsWith('memberid') ||
    normalized.endsWith('membernumber')
  );
}

function sanitizeString(value: string): string {
  return value
    .replace(/(\/member\/)[^/?#\s]+/gi, `$1${REDACTED_VALUE}`)
    .replace(/(\bmember[\s_-]*(?:id|number)\s*[:=]\s*)[^\s,;]+/gi, `$1${REDACTED_VALUE}`)
    .replace(
      /([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|token|password|member[_-]?(?:id|number))=)[^&#\s]*/gi,
      `$1${REDACTED_VALUE}`,
    )
    .replace(
      /(\b(?:authorization|proxy-authorization)\s*[:=]\s*)(?:bearer\s+|basic\s+)?[^\s,;]+/gi,
      `$1${REDACTED_VALUE}`,
    )
    .replace(/(\b(?:cookie|set-cookie)\s*[:=]\s*)[^\r\n]+/gi, `$1${REDACTED_VALUE}`)
    .replace(
      /(\b(?:password|passwd|pwd|api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret)\s*[:=]\s*)[^\s,;&]+/gi,
      `$1${REDACTED_VALUE}`,
    )
    .replace(/\bsk-[a-z0-9_-]{8,}\b/gi, REDACTED_VALUE)
    .replace(/\beyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+\b/gi, REDACTED_VALUE);
}

function freezeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    value.forEach(freezeJson);
    Object.freeze(value);
    return value;
  }

  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(freezeJson);
    Object.freeze(value);
    return value;
  }

  return value;
}

function sanitizeValue(input: unknown, active: WeakSet<object>, depth: number): JsonValue {
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
    return CIRCULAR_VALUE;
  }

  active.add(input);

  try {
    if (Array.isArray(input)) {
      return input.map((value) => sanitizeValue(value, active, depth + 1));
    }

    const output = Object.create(null) as Record<string, JsonValue>;

    for (const [key, value] of Object.entries(input)) {
      output[key] = isSensitiveKey(key) ? REDACTED_VALUE : sanitizeValue(value, active, depth + 1);
    }

    return output;
  } finally {
    active.delete(input);
  }
}

/**
 * Opaque proof that a value passed through the in-memory sanitizer.
 */
export class SanitizedPayload {
  private constructor(readonly value: JsonValue) {
    Object.freeze(this);
  }

  static fromUnknown(input: unknown): SanitizedPayload {
    const sanitized = sanitizeValue(input, new WeakSet(), 0);
    return new SanitizedPayload(freezeJson(sanitized));
  }
}

export function sanitizeForPersistence(input: unknown): SanitizedPayload {
  return SanitizedPayload.fromUnknown(input);
}

export function serializeSanitized(payload: SanitizedPayload): string {
  if (!(payload instanceof SanitizedPayload)) {
    throw new TypeError('Persistence requires a SanitizedPayload');
  }

  return `${JSON.stringify(payload.value, null, 2)}\n`;
}

export function serializeSanitizedLine(payload: SanitizedPayload): string {
  if (!(payload instanceof SanitizedPayload)) {
    throw new TypeError('Persistence requires a SanitizedPayload');
  }

  return `${JSON.stringify(payload.value)}\n`;
}

/**
 * Only already-sanitized bytes reach the filesystem API.
 */
export async function writeSanitizedJson(
  filePath: string,
  payload: SanitizedPayload,
): Promise<void> {
  const serialized = serializeSanitized(payload);

  await writeFile(filePath, serialized, {
    encoding: 'utf8',
  });
}

/**
 * Sanitizes completely in memory before initiating the single write.
 */
export async function sanitizeAndWriteJson(filePath: string, input: unknown): Promise<void> {
  const payload = sanitizeForPersistence(input);
  await writeSanitizedJson(filePath, payload);
}
