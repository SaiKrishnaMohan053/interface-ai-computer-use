import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDemoServer } from '../../demo-app/server.js';

import {
  createBrowserResources,
  PlaywrightSurface,
  startSyntheticTrace,
} from '../../src/surface/playwright/index.js';

import type { BrowserResources, PlaywrightStrategy } from '../../src/surface/playwright/index.js';

import type { ExecutableSurfaceAction } from '../../src/surface/adapter.js';

const options = {
  timeoutMs: 3000,
  maxTextLength: 10_000,
  maxControls: 100,
};

describe('PlaywrightSurface in Chromium', () => {
  let resources: BrowserResources;
  let surface: PlaywrightSurface;

  beforeEach(async () => {
    resources = await createBrowserResources({
      headed: process.env.HEADED === '1',
    });

    surface = new PlaywrightSurface(resources.page, {
      sessionId: 'test',
      surfaceId: 'page',
    });
  });

  afterEach(async () => {
    await resources?.close();
    surface?.dispose();
  });

  const act = (action: ExecutableSurfaceAction) =>
    surface.perform(
      {
        actionId: 'test-action',
        action,
      },
      options,
    );

  async function resolve(strategy: PlaywrightStrategy) {
    const observation = await surface.observe(options);

    if (observation.status !== 'success') {
      throw new Error('observe failed');
    }

    const result = await surface.resolveTarget(
      {
        observationId: observation.observation.observationId,
        description: 'test target',
        strategyIndex: 0,
        strategy,
      },
      options,
    );

    if (result.status !== 'resolved') {
      throw new Error(`resolution: ${result.status}`);
    }

    return result.target;
  }

  const css = (selector: string) => resolve({ kind: 'css', selector });

  it('drives the real demo search and reads the savings balance', async () => {
    const server = createDemoServer();

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    const address = server.address();

    if (!address || typeof address === 'string') {
      throw new Error('No port');
    }

    try {
      expect(
        (
          await act({
            kind: 'navigate',
            destination: `http://127.0.0.1:${address.port}/member-search`,
          })
        ).status,
      ).toBe('success');

      expect(
        (
          await act({
            kind: 'type',
            target: await resolve({
              kind: 'label',
              text: 'Member Name',
            }),
            text: 'Alex Morgan',
            mode: 'replace',
          })
        ).status,
      ).toBe('success');

      expect(
        (
          await act({
            kind: 'click',
            target: await resolve({
              kind: 'role',
              role: 'button',
              name: 'Search',
            }),
          })
        ).status,
      ).toBe('success');

      expect(
        (
          await act({
            kind: 'click',
            target: await resolve({
              kind: 'role',
              role: 'link',
              name: 'Accounts',
            }),
          })
        ).status,
      ).toBe('success');

      const result = await act({
        kind: 'read',
        target: await css('tr:has(td:text-is("Savings")) td:last-child'),
        source: 'text',
      });

      expect(result).toMatchObject({
        status: 'success',
        output: {
          value: '$12,840.50',
        },
      });

      expect(await surface.observe(options)).toMatchObject({
        status: 'success',
        observation: {
          location: {
            title: 'Member Accounts | Demo Credit Union',
          },
        },
      });
    } finally {
      server.close();
      await once(server, 'close');
    }
  });

  it('observes visible controls, omits password values and detects dialogs', async () => {
    await resources.page.setContent(`
      <label>Name<input value="Alex"></label>
      <input type="password" value="secret">
      <button hidden>Hidden</button>
      <span style="opacity:0">invisible</span>
      <section role="dialog" aria-label="Notice">
        <button>Continue</button>
      </section>
    `);

    const result = await surface.observe(options);

    expect(result).toMatchObject({
      status: 'success',
      observation: {
        dialogs: [
          {
            kind: 'surface',
            title: 'Notice',
          },
        ],
      },
    });

    if (result.status !== 'success') {
      throw new Error('observe');
    }

    expect(result.observation.visibleText).not.toContain('invisible');

    expect(result.observation.controls).toContainEqual(
      expect.objectContaining({
        inputType: 'password',
        value: null,
      }),
    );

    expect(
      await surface.observe({
        ...options,
        maxControls: 1,
        maxTextLength: 1,
      }),
    ).toMatchObject({
      observation: {
        truncated: {
          controls: true,
          visibleText: true,
        },
      },
    });
  });

  it('supports append, select, check, uncheck and read', async () => {
    await resources.page.setContent(`
      <input id="name" value="A">
      <select>
        <option value="a">Alpha</option>
        <option value="b">Beta</option>
      </select>
      <input id="check" type="checkbox">
    `);

    expect(
      (
        await act({
          kind: 'type',
          target: await css('#name'),
          text: 'B',
          mode: 'append',
        })
      ).status,
    ).toBe('success');

    expect(
      await act({
        kind: 'read',
        target: await css('#name'),
        source: 'value',
      }),
    ).toMatchObject({
      output: { value: 'AB' },
    });

    for (const option of [
      { kind: 'label', label: 'Beta' },
      { kind: 'value', value: 'a' },
    ] as const) {
      expect(
        (
          await act({
            kind: 'select',
            target: await css('select'),
            option,
          })
        ).status,
      ).toBe('success');
    }

    expect(await resources.page.locator('select').inputValue()).toBe('a');

    expect(
      (
        await act({
          kind: 'check',
          target: await css('#check'),
        })
      ).status,
    ).toBe('success');

    expect(await resources.page.locator('#check').isChecked()).toBe(true);

    expect(
      (
        await act({
          kind: 'uncheck',
          target: await css('#check'),
        })
      ).status,
    ).toBe('success');

    expect(await resources.page.locator('#check').isChecked()).toBe(false);
  });

  it('rejects ambiguous, detached, foreign and outdated handles', async () => {
    await resources.page.setContent('<button>A</button><button>B</button>');

    const observation = await surface.observe(options);

    if (observation.status !== 'success') {
      throw new Error('observe');
    }

    expect(
      await surface.resolveTarget(
        {
          observationId: observation.observation.observationId,
          description: '',
          strategyIndex: 0,
          strategy: {
            kind: 'css',
            selector: 'button',
          },
        },
        options,
      ),
    ).toMatchObject({
      status: 'ambiguous',
      matchCount: 2,
    });

    const target = await css('button:first-child');

    expect(
      await act({
        kind: 'click',
        target: {
          ...target,
          sessionId: 'other',
        },
      }),
    ).toMatchObject({
      status: 'failure',
      error: { code: 'STALE_TARGET' },
    });

    const detached = await css('button:first-child');

    await resources.page.locator('button:first-child').evaluate((el) => el.remove());

    expect(
      await act({
        kind: 'click',
        target: detached,
      }),
    ).toMatchObject({
      status: 'failure',
      error: { code: 'STALE_TARGET' },
    });

    const stale = await css('button');

    await surface.observe(options);

    expect(
      await act({
        kind: 'click',
        target: stale,
      }),
    ).toMatchObject({
      status: 'failure',
      error: { code: 'STALE_TARGET' },
    });
  });

  it('detects and explicitly dismisses a native dialog on the same page', async () => {
    await resources.page.setContent(`
      <button onclick="confirm('Continue?')">Open</button>
    `);

    expect(
      await act({
        kind: 'click',
        target: await css('button'),
      }),
    ).toMatchObject({
      status: 'failure',
      error: { code: 'ACTION_FAILED' },
    });

    const result = await surface.observe(options);

    if (result.status !== 'success') {
      throw new Error('observe');
    }

    const dialog = result.observation.dialogs[0];

    if (!dialog || dialog.kind !== 'native') {
      throw new Error('dialog');
    }

    expect(dialog.message).toBe('Continue?');

    expect(
      (
        await act({
          kind: 'dismiss',
          dialog: {
            kind: 'native',
            observationId: result.observation.observationId,
            dialogId: dialog.dialogId,
            response: {
              kind: 'dismiss',
            },
          },
        })
      ).status,
    ).toBe('success');

    expect(resources.page.isClosed()).toBe(false);

    expect(await surface.observe(options)).toMatchObject({
      observation: {
        dialogs: [],
      },
    });
  });

  it('dismisses a rendered dialog through its resolved control', async () => {
    await resources.page.setContent(`
      <section role="dialog">
        <button onclick="this.parentElement.remove()">
          Close
        </button>
      </section>
    `);

    expect(
      (
        await act({
          kind: 'dismiss',
          dialog: {
            kind: 'surface',
            target: await css('button'),
          },
        })
      ).status,
    ).toBe('success');

    expect(await surface.observe(options)).toMatchObject({
      observation: {
        dialogs: [],
      },
    });
  });

  it('polls conditions, times out mismatches and captures PNG bytes', async () => {
    await resources.page.setContent('<p>waiting</p>');

    await resources.page.evaluate(() => {
      setTimeout(() => {
        document.body.textContent = 'ready';
      }, 80);
    });

    const result = await surface.evaluate(
      {
        conditionId: 'ready',
        prepare: () =>
          Promise.resolve({
            status: 'ready',
            condition: {
              kind: 'textPresent',
              text: 'ready',
              match: 'contains',
              caseSensitive: true,
            },
          }),
      },
      {
        timeoutMs: 1000,
        pollIntervalMs: 20,
      },
    );

    expect(result.status).toBe('passed');
    expect(result.attempts).toBeGreaterThan(1);

    expect(
      await surface.evaluate(
        {
          conditionId: 'missing',
          prepare: () =>
            Promise.resolve({
              status: 'ready',
              condition: {
                kind: 'loadingComplete',
              },
            }),
        },
        {
          timeoutMs: 100,
          pollIntervalMs: 20,
        },
      ),
    ).toMatchObject({
      status: 'not_met',
      reason: 'timeout',
    });

    const shot = await surface.captureEvidence(
      {
        kind: 'screenshot',
        extent: 'viewport',
      },
      options,
    );

    if (shot.status !== 'success' || shot.evidence.kind !== 'screenshot') {
      throw new Error('screenshot');
    }

    expect([...shot.evidence.bytes.slice(0, 4)]).toEqual([137, 80, 78, 71]);
  });

  it('rejects invalid budgets and pre-aborted actions without acting', async () => {
    await resources.page.setContent('<input value="original">');

    expect(
      (
        await surface.observe({
          ...options,
          timeoutMs: 0,
        })
      ).status,
    ).toBe('failure');

    const target = await css('input');
    const signal = AbortSignal.abort();

    expect(
      (
        await surface.perform(
          {
            actionId: 'cancel',
            action: {
              kind: 'type',
              target,
              text: 'changed',
              mode: 'replace',
            },
          },
          {
            ...options,
            signal,
          },
        )
      ).status,
    ).toBe('failure');

    expect(await resources.page.locator('input').inputValue()).toBe('original');
  });

  it('cancels a blocked action and invalidates the surface', async () => {
    await resources.page.setContent('<button disabled>Wait</button>');

    const target = await css('button');
    const controller = new AbortController();

    const timer = setTimeout(() => controller.abort(), 50);

    try {
      expect(
        await surface.perform(
          {
            actionId: 'cancel',
            action: {
              kind: 'click',
              target,
            },
          },
          {
            ...options,
            signal: controller.signal,
          },
        ),
      ).toMatchObject({
        status: 'failure',
        error: {
          code: 'SURFACE_UNAVAILABLE',
        },
      });
    } finally {
      clearTimeout(timer);
    }

    expect((await surface.observe(options)).status).toBe('failure');
  });

  it('records and closes a synthetic-only Playwright trace', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'surface-trace-'));

    try {
      const trace = await startSyntheticTrace(resources.context, {
        dataClassification: 'synthetic-fixture-only',
      });

      await resources.page.setContent('<p>synthetic fixture</p>');

      const path = join(directory, 'trace.zip');

      await trace.stop(path);

      expect((await readFile(path)).subarray(0, 2).toString()).toBe('PK');
    } finally {
      await rm(directory, {
        recursive: true,
        force: true,
      });
    }
  });
});
