import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CIRCULAR_VALUE,
  REDACTED_VALUE,
  type SanitizedPayload,
  sanitizeAndWriteJson,
  sanitizeForPersistence,
  serializeSanitized,
  writeSanitizedJson,
} from '../../src/security/index.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe('recursive persistence redaction', () => {
  it('redacts member IDs, credentials, tokens, cookies and authorization headers', () => {
    const sanitized = sanitizeForPersistence({
      memberId: '12345',
      password: 'hunter2',
      apiKey: 'sk-super-secret-key',
      nested: {
        accessToken: 'access-secret',
        headers: {
          authorization: 'Bearer auth-secret',
          cookie: 'session=private-cookie',
          'x-api-key': 'header-secret',
        },
      },
    }).value;

    expect(sanitized).toEqual({
      memberId: REDACTED_VALUE,
      password: REDACTED_VALUE,
      apiKey: REDACTED_VALUE,
      nested: {
        accessToken: REDACTED_VALUE,
        headers: {
          authorization: REDACTED_VALUE,
          cookie: REDACTED_VALUE,
          'x-api-key': REDACTED_VALUE,
        },
      },
    });
  });

  it('redacts sensitive values embedded in nested strings and URLs', () => {
    const serialized = serializeSanitized(
      sanitizeForPersistence({
        events: [
          'Member ID: 12345',
          'Authorization: Bearer auth-secret',
          'Cookie: session=private-cookie; theme=dark',
          'https://bank.test/member/12345/accounts?access_token=token-secret&view=summary',
          'password=hunter2',
          'generated key sk-abcdefgh12345678',
          'jwt eyJabc.defghi.jklmnop',
        ],
      }),
    );

    for (const secret of [
      '12345',
      'auth-secret',
      'private-cookie',
      'token-secret',
      'hunter2',
      'sk-abcdefgh12345678',
      'eyJabc.defghi.jklmnop',
    ]) {
      expect(serialized).not.toContain(secret);
    }

    expect(serialized).toContain('view=summary');
  });

  it('keeps safe values readable and does not mutate the raw input', () => {
    const raw = {
      memberName: 'Alex Morgan',
      currentBalance: '$12,840.50',
      status: 'Open',
      route: '/member-search',
      metrics: {
        attempt: 2,
        durationMs: 150,
      },
    };

    const serialized = serializeSanitized(sanitizeForPersistence(raw));

    expect(serialized).toContain('Alex Morgan');
    expect(serialized).toContain('$12,840.50');
    expect(serialized).toContain('/member-search');

    expect(raw).toEqual({
      memberName: 'Alex Morgan',
      currentBalance: '$12,840.50',
      status: 'Open',
      route: '/member-search',
      metrics: {
        attempt: 2,
        durationMs: 150,
      },
    });
  });

  it('handles circular objects without leaking nested secrets', () => {
    const raw: {
      password: string;
      self?: unknown;
    } = {
      password: 'circular-secret',
    };

    raw.self = raw;

    expect(sanitizeForPersistence(raw).value).toEqual({
      password: REDACTED_VALUE,
      self: CIRCULAR_VALUE,
    });
  });

  it('creates an immutable sanitized payload', () => {
    const payload = sanitizeForPersistence({
      nested: {
        token: 'secret',
      },
    });

    expect(Object.isFrozen(payload)).toBe(true);
    expect(Object.isFrozen(payload.value)).toBe(true);

    if (
      payload.value !== null &&
      !Array.isArray(payload.value) &&
      typeof payload.value === 'object'
    ) {
      expect(Object.isFrozen(payload.value.nested)).toBe(true);
    }
  });

  it('writes only the already-sanitized representation to the filesystem', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'redaction-'));

    temporaryDirectories.push(directory);

    const filePath = join(directory, 'event.json');

    await sanitizeAndWriteJson(filePath, {
      event: 'member-read',
      memberId: '12345',
      nested: {
        authorization: 'Bearer raw-auth-token',
      },
      currentBalance: '$12,840.50',
    });

    const persisted = await readFile(filePath, 'utf8');

    expect(persisted).not.toContain('12345');
    expect(persisted).not.toContain('raw-auth-token');
    expect(persisted).toContain(REDACTED_VALUE);
    expect(persisted).toContain('$12,840.50');
  });

  it('rejects an unbranded payload at the filesystem boundary', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'redaction-'));

    temporaryDirectories.push(directory);

    const filePath = join(directory, 'forged.json');

    const forgedPayload: unknown = {
      value: {
        password: 'raw-secret',
      },
    };

    await expect(writeSanitizedJson(filePath, forgedPayload as SanitizedPayload)).rejects.toThrow(
      'Persistence requires a SanitizedPayload',
    );
  });
});
