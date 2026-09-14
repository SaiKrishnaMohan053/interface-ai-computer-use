import { describe, expect, it } from 'vitest';

import { isUninitializedPlaywrightDocument } from '../../src/surface/playwright/initial-document.js';

describe('Playwright initial document detection', () => {
  it('treats only the new-page about:blank document as uninitialized', () => {
    expect(
      isUninitializedPlaywrightDocument('about:blank', '<html><head></head><body></body></html>'),
    ).toBe(true);

    expect(
      isUninitializedPlaywrightDocument(
        'about:blank',
        '<html><body><div role="dialog">Notice</div></body></html>',
      ),
    ).toBe(false);

    expect(
      isUninitializedPlaywrightDocument(
        'http://127.0.0.1:3000/member-search',
        '<html><head></head><body></body></html>',
      ),
    ).toBe(false);

    expect(
      isUninitializedPlaywrightDocument(
        'https://bank.test/',
        '<html><head></head><body></body></html>',
      ),
    ).toBe(false);
  });
});
