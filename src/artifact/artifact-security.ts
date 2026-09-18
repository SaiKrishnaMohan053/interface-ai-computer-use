import { ArtifactError } from './artifact-errors.js';

export interface ArtifactSecurityScanOptions {
  /**
   * Concrete discovery values that must not survive parameterization.
   *
   * Examples:
   * - member name used during discovery
   * - concrete extracted balance
   *
   * These values are supplied by deterministic compiler metadata rather
   * than hard-coded into the scanner.
   */
  readonly forbiddenLiterals?: readonly string[];
}

const FORBIDDEN_KEY_NAMES = new Set([
  'apikey',
  'apitoken',
  'accesstoken',
  'refreshtoken',
  'token',
  'cookie',
  'cookies',
  'password',
  'passwd',
  'authorization',
  'authheader',
  'authorizationheader',

  'browsercontextid',
  'browsercontext',
  'pagehandle',
  'locator',
  'locatorobject',
  'elementhandle',
  'element',

  'rawdom',
  'rawhtml',
  'rawopenairesponse',
  'rawmodelresponse',
  'modelresponse',

  'chainofthought',
  'chainofthoughts',
  'reasoning',
  'reasoningtrace',
  'modelrationale',

  'sessionid',
  'browsersessionid',
]);

function normalizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function normalizeForbiddenLiteral(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function containsSecretLikeValue(value: string): boolean {
  const trimmed = value.trim();

  if (/^bearer\s+\S+/i.test(trimmed)) {
    return true;
  }

  if (/^basic\s+[A-Za-z0-9+/=]+$/i.test(trimmed)) {
    return true;
  }

  if (/^sk-[A-Za-z0-9_-]{16,}$/i.test(trimmed)) {
    return true;
  }

  if (/^cookie\s*:/i.test(trimmed)) {
    return true;
  }

  return false;
}

function containsRawDom(value: string): boolean {
  const trimmed = value.trim();

  return (
    /^<!doctype\s+html/i.test(trimmed) ||
    /^<html[\s>]/i.test(trimmed) ||
    /^<body[\s>]/i.test(trimmed) ||
    /^<div[\s>][\s\S]*<\/div>$/i.test(trimmed)
  );
}

function scanValue(
  value: unknown,
  path: readonly string[],
  forbiddenLiterals: ReadonlySet<string>,
): void {
  if (typeof value === 'string') {
    const normalized = normalizeForbiddenLiteral(value);

    const containsForbiddenLiteral = Array.from(forbiddenLiterals).some(
      (literal) => literal.length > 0 && normalized.includes(literal),
    );

    if (containsForbiddenLiteral) {
      throw new ArtifactError(
        'ARTIFACT_SENSITIVE_DATA_DETECTED',
        `Artifact contains a forbidden discovery-specific value at ${path.join('.')}`,
      );
    }

    if (containsSecretLikeValue(value)) {
      throw new ArtifactError(
        'ARTIFACT_SENSITIVE_DATA_DETECTED',
        `Artifact contains secret-like data at ${path.join('.')}`,
      );
    }

    if (containsRawDom(value)) {
      throw new ArtifactError(
        'ARTIFACT_SENSITIVE_DATA_DETECTED',
        `Artifact contains raw DOM or HTML at ${path.join('.')}`,
      );
    }

    return;
  }

  if (value === null) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      scanValue(item, [...path, String(index)], forbiddenLiterals);
    });

    return;
  }

  if (typeof value === 'object') {
    for (const [key, nestedValue] of Object.entries(value)) {
      const normalizedKey = normalizeKey(key);

      if (FORBIDDEN_KEY_NAMES.has(normalizedKey)) {
        throw new ArtifactError(
          'ARTIFACT_SENSITIVE_DATA_DETECTED',
          `Artifact contains forbidden field "${key}" at ${path.join('.') || '<root>'}`,
        );
      }

      scanValue(nestedValue, [...path, key], forbiddenLiterals);
    }

    return;
  }

  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new ArtifactError(
      'ARTIFACT_SENSITIVE_DATA_DETECTED',
      `Artifact contains a non-serializable runtime value at ${path.join('.')}`,
    );
  }
}

/**
 * Fail-closed security scan for reusable capability artifacts.
 *
 * This scanner does not redact unsafe values. Compilation must fail so that
 * the compiler can fix parameterization before persistence.
 */
export function assertArtifactSafeToPersist(
  value: unknown,
  options: ArtifactSecurityScanOptions = {},
): void {
  const forbiddenLiterals = new Set(
    (options.forbiddenLiterals ?? [])
      .map(normalizeForbiddenLiteral)
      .filter((literal) => literal.length > 0),
  );

  scanValue(value, [], forbiddenLiterals);
}
