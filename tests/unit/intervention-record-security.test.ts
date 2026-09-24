import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const allowedRequestKeys = new Set([
  'id',
  'sessionId',
  'source',
  'capabilityId',
  'capabilityVersion',
  'goal',
  'stepId',
  'reasonCode',
  'reason',
  'observedState',
  'evidenceRefs',
  'createdAt',
  'status',
]);

const forbiddenRawStateTerms = [
  'rawPageState',
  'pageState',
  'rawDom',
  'rawHtml',
  'domSnapshot',
  'browserContext',
  'pageHandle',
  'storageState',
  'localStorage',
  'sessionStorage',
  'cookies',
  'authorization',
];

function collectKeys(value: unknown, output: Set<string>): void {
  if (value === null || typeof value !== 'object') {
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectKeys(entry, output);
    }

    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    output.add(key);
    collectKeys(nested, output);
  }
}

describe('intervention record security', () => {
  it('keeps the persisted request schema intentionally compact and strict', async () => {
    const source = await readFile('src/intervention/intervention-types.ts', 'utf8');

    expect(source).toContain('interventionRequestSchema');

    expect(source).toMatch(/interventionRequestSchema[\s\S]*?\.strict\(\)/u);

    for (const term of forbiddenRawStateTerms) {
      expect(source).not.toContain(`${term}:`);
    }
  });

  it('does not add raw page/browser state to manager creation', async () => {
    const source = await readFile('src/intervention/intervention-manager.ts', 'utf8');

    for (const term of forbiddenRawStateTerms) {
      expect(source).not.toContain(`${term}: input.${term}`);
    }

    expect(source).toContain('observedState: input.observedState');

    expect(source).toContain('evidenceRefs: input.evidenceRefs ?? []');
  });

  it('sanitizes filesystem persistence before serialization', async () => {
    const source = await readFile('src/intervention/intervention-store.ts', 'utf8');

    expect(source).toContain('sanitizeForPersistence');

    expect(source).toContain('serializeSanitized');
  });

  it('limits frozen intervention.json to the stored intervention contract rather than browser runtime objects', async () => {
    const source = await readFile('src/intervention/intervention-evidence-package.ts', 'utf8');

    expect(source).toContain('sanitizeForPersistence(intervention)');

    for (const term of ['BrowserContext', 'Page', 'ElementHandle', 'Locator', 'storageState']) {
      expect(source).not.toContain(`intervention.${term}`);
    }
  });

  it('rejects raw-state-shaped reviewer evidence by key audit', () => {
    const safeRequest = {
      id: 'intervention-1',
      sessionId: 'session-1',
      source: 'REPLAY',
      capabilityId: 'prepare_new_savings_subaccount',
      capabilityVersion: '1.0.0',
      stepId: 'confirm-create',
      reasonCode: 'HUMAN_APPROVAL_REQUIRED',
      reason: 'Final create requires human involvement',
      observedState: 'Sub-account review screen',
      evidenceRefs: [],
      createdAt: '2026-09-23T20:00:00.000Z',
      status: 'WAITING_FOR_HUMAN',
    };

    const keys = new Set<string>();

    collectKeys(safeRequest, keys);

    for (const key of Object.keys(safeRequest)) {
      expect(allowedRequestKeys.has(key)).toBe(true);
    }

    for (const term of forbiddenRawStateTerms) {
      expect(keys.has(term)).toBe(false);
    }
  });
});
