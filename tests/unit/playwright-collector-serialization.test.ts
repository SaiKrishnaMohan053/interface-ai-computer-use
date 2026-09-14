import { describe, expect, it } from 'vitest';

import { collect } from '../../src/surface/playwright/collect.js';

describe('Playwright observation collector serialization', () => {
  it('does not depend on Node-side transform helpers', () => {
    const source = collect.toString();

    expect(source).not.toContain('__name');
    expect(source).not.toContain('__publicField');
    expect(source).not.toContain('__private');
  });
});
