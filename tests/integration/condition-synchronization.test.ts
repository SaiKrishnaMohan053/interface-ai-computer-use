import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { createDemoServer } from '../../demo-app/server.js';
import { ConditionEvaluator } from '../../src/conditions/index.js';
import { createBrowserResources, PlaywrightSurface } from '../../src/surface/playwright/index.js';
import type { BrowserResources } from '../../src/surface/playwright/index.js';
import { TargetResolver } from '../../src/targeting/index.js';
import type { TargetSpec } from '../../src/targeting/index.js';

const exact = (value: string) => ({
  value,
  mode: 'exact' as const,
  caseSensitive: true,
});

const target = (description: string, role: string, name: string): TargetSpec => ({
  description,
  cardinality: 'exactly-one',
  strategies: [
    {
      kind: 'role-name',
      role,
      name: exact(name),
    },
  ],
});

describe('condition-based synchronization', () => {
  let resources: BrowserResources | undefined;
  let surface: PlaywrightSurface | undefined;

  afterEach(async () => {
    await resources?.close();
    surface?.dispose();
  });

  it('clicks Search, waits for loadingComplete, then verifies Member Details', async () => {
    const server = createDemoServer();

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    const address = server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Demo server has no port');
    }

    try {
      resources = await createBrowserResources();

      surface = new PlaywrightSurface(resources.page, {
        sessionId: 'synchronization-session',
        surfaceId: 'member-search-page',
      });

      const evaluator = new ConditionEvaluator(surface);
      const resolver = new TargetResolver(surface);

      const waitOptions = {
        timeoutMs: 8000,
        pollIntervalMs: 50,
      };

      const navigation = await surface.perform(
        {
          actionId: 'open-slow-member-search',
          action: {
            kind: 'navigate',
            destination: `http://127.0.0.1:${address.port}` + '/member-search?scenario=slow',
          },
        },
        {
          timeoutMs: 3000,
        },
      );

      expect(navigation.status).toBe('success');

      expect(
        await evaluator.evaluate(
          {
            conditionId: 'member-search-loaded',
            condition: {
              kind: 'loadingComplete',
            },
          },
          waitOptions,
        ),
      ).toMatchObject({
        status: 'passed',
        passed: true,
      });

      const resolve = async (spec: TargetSpec) => {
        if (!surface) {
          throw new Error('Surface unavailable');
        }

        const observation = await surface.observe({
          timeoutMs: 3000,
          maxTextLength: 20_000,
          maxControls: 200,
        });

        if (observation.status !== 'success') {
          throw new Error(observation.error.code);
        }

        const result = await resolver.resolve(
          {
            observationId: observation.observation.observationId,
            target: spec,
          },
          {
            timeoutMs: 3000,
          },
        );

        if (result.status !== 'resolved') {
          throw new Error(result.error.code);
        }

        return result.target;
      };

      const memberName = await resolve(target('Member name input', 'textbox', 'Member Name'));

      expect(
        await surface.perform(
          {
            actionId: 'enter-member-name',
            action: {
              kind: 'type',
              target: memberName,
              text: 'Alex Morgan',
              mode: 'replace',
            },
          },
          {
            timeoutMs: 3000,
          },
        ),
      ).toMatchObject({
        status: 'success',
      });

      const search = await resolve(target('Search button', 'button', 'Search'));

      expect(
        await surface.perform(
          {
            actionId: 'search-member',
            action: {
              kind: 'click',
              target: search,
            },
          },
          {
            timeoutMs: 3000,
          },
        ),
      ).toMatchObject({
        status: 'success',
      });

      const loading = await evaluator.evaluate(
        {
          conditionId: 'member-details-loaded',
          condition: {
            kind: 'loadingComplete',
          },
        },
        waitOptions,
      );

      expect(loading).toMatchObject({
        status: 'passed',
        passed: true,
        expected: 'complete',
        observed: 'complete',
      });

      expect(loading.attempts).toBeGreaterThan(0);

      const details = await evaluator.evaluate(
        {
          conditionId: 'member-details-visible',
          condition: {
            kind: 'textPresent',
            text: 'Member Details',
            match: 'contains',
            caseSensitive: true,
          },
        },
        {
          timeoutMs: 3000,
          pollIntervalMs: 50,
        },
      );

      expect(details).toMatchObject({
        status: 'passed',
        passed: true,
        expected: true,
        observed: true,
      });

      expect(new URL(resources.page.url()).pathname).toBe('/member/12345');
    } finally {
      server.close();
      await once(server, 'close');
    }
  });

  it('stops polling when its explicit timeout expires', async () => {
    resources = await createBrowserResources();

    await resources.page.setContent(`
      <main data-surface-ready="true">
        <section aria-busy="true">
          Still loading
        </section>
      </main>
    `);

    surface = new PlaywrightSurface(resources.page, {
      sessionId: 'timeout-session',
      surfaceId: 'loading-page',
    });

    const evaluator = new ConditionEvaluator(surface);
    const timeoutMs = 150;

    const result = await evaluator.evaluate(
      {
        conditionId: 'loading-timeout',
        condition: {
          kind: 'loadingComplete',
        },
      },
      {
        timeoutMs,
        pollIntervalMs: 20,
      },
    );

    expect(result).toMatchObject({
      status: 'not_met',
      passed: false,
      reason: 'timeout',
      expected: 'complete',
      observed: 'loading',
    });

    expect(result.attempts).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(timeoutMs);
    expect(result.durationMs).toBeLessThan(timeoutMs + 500);
  });
});
