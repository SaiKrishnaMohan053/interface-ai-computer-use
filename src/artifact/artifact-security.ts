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

/**
 * Field names that must never appear in a reusable persisted artifact.
 *
 * Keys are normalized before comparison:
 *
 * api_key
 * api-key
 * ApiKey
 *
 * all become:
 *
 * apikey
 */
const FORBIDDEN_KEY_NAMES = new Set([
  // Secrets / credentials.
  'apikey',
  'apitoken',
  'accesstoken',
  'refreshtoken',
  'token',
  'secrettoken',
  'clientsecret',
  'secret',
  'cookie',
  'cookies',
  'setcookie',
  'password',
  'passwd',
  'pwd',
  'authorization',
  'authheader',
  'authorizationheader',

  // Browser/runtime handles and identifiers.
  'browsercontextid',
  'browsercontext',
  'pagehandle',
  'pageid',
  'locator',
  'locatorobject',
  'locatorid',
  'elementhandle',
  'element',
  'jshandle',
  'cdpsession',
  'resolvedtarget',
  'targethandle',
  'runtimehandle',
  'runtimeid',

  // Raw DOM / HTML.
  'rawdom',
  'rawhtml',
  'htmlsnapshot',
  'domsnapshot',

  // Raw provider/model payloads.
  'rawopenairesponse',
  'rawmodelresponse',
  'modelresponse',
  'rawproviderresponse',
  'providerresponse',
  'rawproviderpayload',
  'providerpayload',
  'rawmodelpayload',
  'modelpayload',
  'rawrequestpayload',
  'rawresponsepayload',

  // Model reasoning / rationale.
  'chainofthought',
  'chainofthoughts',
  'cot',
  'reasoning',
  'reasoningtrace',
  'modelrationale',
  'rationale',

  // Session/run-time transient IDs.
  //
  // discoveryRunId is intentionally NOT forbidden. It is safe provenance.
  'sessionid',
  'browsersessionid',
  'observationid',
  'actionid',
  'dialogid',
  'frameid',
]);

function normalizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function normalizeForbiddenLiteral(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function containsSecretLikeValue(value: string): boolean {
  const trimmed = value.trim();

  // Authorization header values.
  if (/^bearer\s+\S+/i.test(trimmed)) {
    return true;
  }

  if (/^basic\s+[A-Za-z0-9+/=]+$/i.test(trimmed)) {
    return true;
  }

  // OpenAI-style API keys.
  if (/^sk-[A-Za-z0-9_-]{16,}$/i.test(trimmed)) {
    return true;
  }

  // GitHub tokens.
  if (/^(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}$/i.test(trimmed)) {
    return true;
  }

  if (/^github_pat_[A-Za-z0-9_]{20,}$/i.test(trimmed)) {
    return true;
  }

  // Slack-style tokens.
  if (/^xox[baprs]-[A-Za-z0-9-]{10,}$/i.test(trimmed)) {
    return true;
  }

  // Google-style API key.
  if (/^AIza[A-Za-z0-9_-]{20,}$/i.test(trimmed)) {
    return true;
  }

  // JWT-like bearer material.
  if (/^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/.test(trimmed)) {
    return true;
  }

  // Header-looking cookie data.
  if (/^cookie\s*:/i.test(trimmed)) {
    return true;
  }

  if (/^set-cookie\s*:/i.test(trimmed)) {
    return true;
  }

  // Credentials embedded in otherwise generic text fields.
  if (/\b(?:password|passwd|pwd)\s*[:=]\s*\S+/i.test(trimmed)) {
    return true;
  }

  if (
    /\b(?:api[_ -]?key|api[_ -]?token|access[_ -]?token|refresh[_ -]?token)\s*[:=]\s*\S+/i.test(
      trimmed,
    )
  ) {
    return true;
  }

  if (/\bauthorization\s*:\s*(?:bearer|basic)\s+\S+/i.test(trimmed)) {
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
    /^<div[\s>][\s\S]*<\/div>$/i.test(trimmed) ||
    /^<form[\s>][\s\S]*<\/form>$/i.test(trimmed) ||
    /^<table[\s>][\s\S]*<\/table>$/i.test(trimmed)
  );
}

function containsRuntimeHandleValue(value: string): boolean {
  const trimmed = value.trim();

  /*
   * Do not reject ordinary words such as "page" or "element".
   *
   * These patterns target concrete browser/runtime object names that have
   * no place in a declarative persisted artifact.
   */
  return (
    /\bBrowserContext\b/.test(trimmed) ||
    /\bElementHandle\b/.test(trimmed) ||
    /\bJSHandle\b/.test(trimmed) ||
    /\bCDPSession\b/.test(trimmed) ||
    /\bResolvedTarget\b/.test(trimmed) ||
    /\bLocator@/i.test(trimmed) ||
    /\bPlaywright\b.*\bLocator\b/i.test(trimmed)
  );
}

function containsProviderPayloadMarker(value: string): boolean {
  const trimmed = value.trim();

  /*
   * Catch raw provider objects accidentally stringified into metadata.
   *
   * This is deliberately narrower than looking for normal words such as
   * "OpenAI" or "model", which may legitimately appear in documentation.
   */
  return /"choices"\s*:\s*\[/i.test(trimmed) && /"usage"\s*:/i.test(trimmed);
}

function throwSensitive(
  message: string,
  path: readonly string[],
  details?: Readonly<Record<string, unknown>>,
): never {
  throw new ArtifactError('ARTIFACT_SENSITIVE_DATA_DETECTED', message, {
    path: path.join('.') || '<root>',
    ...details,
  });
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
      throwSensitive(
        `Artifact contains a forbidden discovery-specific value at ${path.join('.') || '<root>'}`,
        path,
      );
    }

    if (containsSecretLikeValue(value)) {
      throwSensitive(`Artifact contains secret-like data at ${path.join('.') || '<root>'}`, path);
    }

    if (containsRawDom(value)) {
      throwSensitive(`Artifact contains raw DOM or HTML at ${path.join('.') || '<root>'}`, path);
    }

    if (containsRuntimeHandleValue(value)) {
      throwSensitive(
        `Artifact contains browser or runtime handle data at ${path.join('.') || '<root>'}`,
        path,
      );
    }

    if (containsProviderPayloadMarker(value)) {
      throwSensitive(
        `Artifact contains a raw model or provider payload at ${path.join('.') || '<root>'}`,
        path,
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
        throwSensitive(
          `Artifact contains forbidden field "${key}" at ${path.join('.') || '<root>'}`,
          path,
          {
            field: key,
          },
        );
      }

      scanValue(nestedValue, [...path, key], forbiddenLiterals);
    }

    return;
  }

  /*
   * Persisted artifacts must remain plain JSON data.
   *
   * undefined is rejected too. JSON.stringify would silently discard it,
   * which is not acceptable for a fail-closed persistence gate.
   */
  if (
    value === undefined ||
    typeof value === 'function' ||
    typeof value === 'symbol' ||
    typeof value === 'bigint'
  ) {
    throwSensitive(
      `Artifact contains a non-serializable runtime value at ${path.join('.') || '<root>'}`,
      path,
    );
  }

  /*
   * number and boolean values are normal JSON-compatible artifact values.
   */
}

/**
 * Fail-closed final security gate for reusable capability artifacts.
 *
 * The scanner never sanitizes or redacts persisted artifacts.
 *
 * If forbidden content survives parameterization/normalization,
 * compilation must fail with ARTIFACT_SENSITIVE_DATA_DETECTED.
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
