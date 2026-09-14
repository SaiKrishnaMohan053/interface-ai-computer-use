import { describe, expect, it } from 'vitest';

import { resolveStructuralQuery } from '../../src/surface/playwright/resolve-strategy.js';

describe('Playwright structural query serialization', () => {
  it('does not depend on Node-side transform helpers', () => {
    const source = resolveStructuralQuery.toString();

    expect(source).not.toContain('__name');
    expect(source).not.toContain('__publicField');
    expect(source).not.toContain('__private');
  });
});
