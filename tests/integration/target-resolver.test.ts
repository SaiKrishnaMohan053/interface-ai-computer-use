import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TargetResolver } from '../../src/targeting/index.js';

import { createBrowserResources, PlaywrightSurface } from '../../src/surface/playwright/index.js';

import type { BrowserResources } from '../../src/surface/playwright/index.js';

const exact = (value: string) => ({
  value,
  mode: 'exact' as const,
  caseSensitive: true,
});

describe('TargetResolver with PlaywrightSurface', () => {
  let resources: BrowserResources;
  let surface: PlaywrightSurface;
  let resolver: TargetResolver;

  beforeEach(async () => {
    resources = await createBrowserResources();

    surface = new PlaywrightSurface(resources.page, {
      sessionId: 'session',
      surfaceId: 'page',
    });

    resolver = new TargetResolver(surface);
  });

  afterEach(async () => {
    await resources.close();
    surface.dispose();
  });

  async function observationId(): Promise<string> {
    const result = await surface.observe({
      timeoutMs: 3000,
      maxTextLength: 10_000,
      maxControls: 100,
    });

    if (result.status !== 'success') {
      throw new Error('Observation failed');
    }

    return result.observation.observationId;
  }

  it('uses ordered zero, ambiguous, then exactly-one fallback', async () => {
    await resources.page.setContent(`
        <button>Duplicate</button>
        <button>Duplicate</button>
        <button id="target">Unique</button>
      `);

    const result = await resolver.resolve(
      {
        observationId: await observationId(),

        target: {
          description: 'Unique button',

          cardinality: 'exactly-one',

          strategies: [
            {
              kind: 'text',
              text: exact('Missing'),
            },
            {
              kind: 'text',
              text: exact('Duplicate'),
            },
            {
              kind: 'css',
              selector: '#target',
            },
          ],
        },
      },
      {
        timeoutMs: 3000,
      },
    );

    expect(result).toMatchObject({
      status: 'resolved',

      target: {
        matchedStrategyIndex: 2,
      },

      attempts: [
        {
          outcome: 'not-found',
          matchCount: 0,
        },
        {
          outcome: 'ambiguous',
          matchCount: 2,
        },
        {
          outcome: 'resolved',
          matchCount: 1,
        },
      ],
    });
  });

  it('returns TARGET_AMBIGUOUS after exhausting fallbacks', async () => {
    await resources.page.setContent(`
        <button>Duplicate</button>
        <button>Duplicate</button>
      `);

    const result = await resolver.resolve(
      {
        observationId: await observationId(),

        target: {
          description: 'Button',

          cardinality: 'exactly-one',

          strategies: [
            {
              kind: 'text',

              text: exact('Duplicate'),
            },
            {
              kind: 'css',
              selector: '#missing',
            },
          ],
        },
      },
      {
        timeoutMs: 3000,
      },
    );

    expect(result).toMatchObject({
      status: 'failure',

      error: {
        code: 'TARGET_AMBIGUOUS',
      },
    });
  });

  it('resolves a table cell structurally by table, row key and result column', async () => {
    await resources.page.setContent(`
        <table>
          <caption>Accounts</caption>
          <thead>
            <tr>
              <th>Account Type</th>
              <th>Current Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Checking</td>
              <td>$200.00</td>
            </tr>
            <tr>
              <td>Savings</td>
              <td>$12,840.50</td>
            </tr>
          </tbody>
        </table>
      `);

    const result = await resolver.resolve(
      {
        observationId: await observationId(),

        target: {
          description: 'Savings current balance',

          cardinality: 'exactly-one',

          strategies: [
            {
              kind: 'structural',

              query: {
                kind: 'table-cell',

                table: {
                  name: exact('Accounts'),
                },

                row: {
                  columnHeader: exact('Account Type'),

                  value: exact('Savings'),
                },

                column: {
                  header: exact('Current Balance'),
                },
              },
            },
          ],
        },
      },
      {
        timeoutMs: 3000,
      },
    );

    if (result.status !== 'resolved') {
      throw new Error('Resolution failed');
    }

    expect(
      await surface.perform(
        {
          actionId: 'read-balance',

          action: {
            kind: 'read',
            target: result.target,
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
        value: '$12,840.50',
      },
    });
  });

  it('executes all six target strategy types', async () => {
    await resources.page.setContent(`
        <section
          role="dialog"
          aria-label="Notice"
        >
          <button>Continue</button>
        </section>

        <label for="name">
          Member Name
        </label>

        <input id="name">

        <p>Visible Status</p>

        <div id="css-target">
          CSS
        </div>

        <div class="xpath-target">
          XPath
        </div>
      `);

    const id = await observationId();

    const targets = [
      {
        description: 'button',

        cardinality: 'exactly-one',

        strategies: [
          {
            kind: 'role-name',

            role: 'button',

            name: exact('Continue'),
          },
        ],
      },
      {
        description: 'input',

        cardinality: 'exactly-one',

        strategies: [
          {
            kind: 'label',

            label: exact('Member Name'),
          },
        ],
      },
      {
        description: 'status',

        cardinality: 'exactly-one',

        strategies: [
          {
            kind: 'text',

            text: exact('Visible Status'),
          },
        ],
      },
      {
        description: 'dialog button',

        cardinality: 'exactly-one',

        strategies: [
          {
            kind: 'structural',

            query: {
              kind: 'within',

              container: {
                role: 'dialog',

                name: exact('Notice'),
              },

              target: {
                role: 'button',

                name: exact('Continue'),
              },
            },
          },
        ],
      },
      {
        description: 'css div',

        cardinality: 'exactly-one',

        strategies: [
          {
            kind: 'css',
            selector: '#css-target',
          },
        ],
      },
      {
        description: 'xpath div',

        cardinality: 'exactly-one',

        strategies: [
          {
            kind: 'xpath',

            expression: '//div[@class="xpath-target"]',
          },
        ],
      },
    ];

    for (const target of targets) {
      const result = await resolver.resolve(
        {
          observationId: id,
          target,
        },
        {
          timeoutMs: 3000,
        },
      );

      if (result.status === 'failure') {
        throw new Error(
          [
            `Strategy test failed: ${target.description}`,
            `Error: ${result.error.code}`,
            `Message: ${result.error.message}`,
            `Attempts: ${JSON.stringify(result.attempts)}`,
          ].join('\n'),
        );
      }

      expect(result.status).toBe('resolved');
    }
  });
});
