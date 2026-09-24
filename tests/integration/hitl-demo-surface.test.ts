import { afterEach, describe, expect, it } from 'vitest';
import { once } from 'node:events';
import type { Server } from 'node:http';

import { createDemoServer } from '../../demo-app/server.js';

describe('synthetic HITL commit surface', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => {
          if (error === undefined) {
            resolve();
            return;
          }

          reject(error);
        });
      });
    }

    server = undefined;
  });

  it('exposes review-only state followed by an explicit synthetic final commit surface', async () => {
    server = createDemoServer();
    server.listen(0, '127.0.0.1');

    await once(server, 'listening');

    const address = server.address();

    if (address === null || typeof address === 'string') {
      throw new Error('Demo server did not expose a TCP port');
    }

    const origin = `http://127.0.0.1:${address.port}`;

    const form = await fetch(`${origin}/member/12345/subaccounts/new`);
    const formHtml = await form.text();

    const accountMatch = /<option value="([^"]+)">[^<]+<\/option>/.exec(formHtml);

    expect(accountMatch?.[1]).toBeDefined();

    const parentAccountId = accountMatch?.[1];

    if (parentAccountId === undefined) {
      throw new Error('Expected at least one open synthetic parent account');
    }

    const reviewUrl = new URL(`${origin}/member/12345/subaccounts/review`);
    reviewUrl.searchParams.set('parentAccountId', parentAccountId);
    reviewUrl.searchParams.set('nickname', 'Human Handoff Savings');

    const review = await fetch(reviewUrl);
    const reviewHtml = await review.text();

    expect(review.status).toBe(200);
    expect(reviewHtml).toContain('Review only. No sub-account has been created.');
    expect(reviewHtml).toContain('Confirm Create Sub-Account');
    expect(reviewHtml).toContain('/member/12345/subaccounts/commit');

    const commitUrl = new URL(`${origin}/member/12345/subaccounts/commit`);
    commitUrl.searchParams.set('parentAccountId', parentAccountId);
    commitUrl.searchParams.set('nickname', 'Human Handoff Savings');

    const committed = await fetch(commitUrl);
    const committedHtml = await committed.text();

    expect(committed.status).toBe(200);
    expect(committedHtml).toContain('Sub-account created');
    expect(committedHtml).toContain('Synthetic demonstration only.');
    expect(committedHtml).toContain('No real banking transaction occurred.');
  });
});
