import { describe, expect, it } from 'vitest';

import { createDiscoveryCliPolicy } from '../../src/cli/discover-runtime.js';

describe('Discovery CLI runtime composition', () => {
  it('scopes policy to the supplied target origin', () => {
    const policy = createDiscoveryCliPolicy('http://127.0.0.1:3000/member-search');

    expect(
      policy.evaluate({
        url: 'http://127.0.0.1:3000/member/alex/accounts',
        action: { kind: 'read' },
        systemRiskLevel: 'READ_ONLY',
      }),
    ).toMatchObject({ decision: 'ALLOW' });

    expect(
      policy.evaluate({
        url: 'https://other.test/member-search',
        action: { kind: 'read' },
        systemRiskLevel: 'READ_ONLY',
      }),
    ).toMatchObject({ decision: 'DENY' });
  });

  it('does not allow the CLI policy to under-classify irreversible clicks', () => {
    const policy = createDiscoveryCliPolicy('http://127.0.0.1:3000/member-search');

    expect(
      policy.evaluate({
        url: 'http://127.0.0.1:3000/member/alex/accounts',
        action: { kind: 'click' },
        systemRiskLevel: 'IRREVERSIBLE',
      }),
    ).toMatchObject({ decision: 'DENY' });
  });
});
