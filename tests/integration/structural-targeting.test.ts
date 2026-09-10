import { once } from 'node:events';

import { afterEach, describe, expect, it } from 'vitest';

import { createDemoServer } from '../../demo-app/server.js';

import { createBrowserResources, PlaywrightSurface } from '../../src/surface/playwright/index.js';

import type { BrowserResources } from '../../src/surface/playwright/index.js';

import { createTableCellTargetSpec, TargetResolver } from '../../src/targeting/index.js';

const exact = (value: string) => ({
  value,
  mode: 'exact' as const,
  caseSensitive: true,
});

describe('semantic accounts-table targeting', () => {
  let resources: BrowserResources | undefined;

  let surface: PlaywrightSurface | undefined;

  afterEach(async () => {
    await resources?.close();
    surface?.dispose();
  });

  it('reads Savings Current Balance without stored row or column positions', async () => {
    const server = createDemoServer();

    server.listen(0, '127.0.0.1');

    await once(server, 'listening');

    const address = server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Demo server has no port');
    }

    try {
      resources = await createBrowserResources();

      await resources.page.goto(`http://127.0.0.1:${address.port}/member/12345/accounts`);

      surface = new PlaywrightSurface(resources.page, {
        sessionId: 'structural-session',

        surfaceId: 'accounts-page',
      });

      const observation = await surface.observe({
        timeoutMs: 3000,
        maxTextLength: 10_000,
        maxControls: 100,
      });

      if (observation.status !== 'success') {
        throw new Error('Observation failed');
      }

      const target = createTableCellTargetSpec({
        description: 'Savings current balance',

        tableName: exact('Accounts'),

        rowColumnHeader: exact('Account Type'),

        rowValue: exact('Savings'),

        resultColumnHeader: exact('Current Balance'),
      });

      expect(JSON.stringify(target)).not.toMatch(/rowIndex|columnIndex|row 3|column 4/i);

      const resolution = await new TargetResolver(surface).resolve(
        {
          observationId: observation.observation.observationId,

          target,
        },
        {
          timeoutMs: 3000,
        },
      );

      if (resolution.status !== 'resolved') {
        throw new Error(resolution.error.code);
      }

      expect(
        await surface.perform(
          {
            actionId: 'read-savings-balance',

            action: {
              kind: 'read',
              target: resolution.target,

              source: 'text',
            },
          },
          {
            timeoutMs: 3000,
          },
        ),
      ).toMatchObject({
        status: 'success',

        output: {
          kind: 'read',
          value: '$12,840.50',
        },
      });
    } finally {
      server.close();

      await once(server, 'close');
    }
  });
});
