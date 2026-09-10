import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConditionEvaluator } from '../../src/conditions/index.js';
import { createBrowserResources, PlaywrightSurface } from '../../src/surface/playwright/index.js';
import type { BrowserResources } from '../../src/surface/playwright/index.js';

const cssTarget = (description: string, selector: string) => ({
  description,
  cardinality: 'exactly-one' as const,
  strategies: [
    {
      kind: 'css' as const,
      selector,
    },
  ],
});

describe('ConditionEvaluator with PlaywrightSurface', () => {
  let resources: BrowserResources;
  let surface: PlaywrightSurface;
  let evaluator: ConditionEvaluator;

  beforeEach(async () => {
    resources = await createBrowserResources();

    surface = new PlaywrightSurface(resources.page, {
      sessionId: 'condition-session',
      surfaceId: 'condition-page',
    });

    evaluator = new ConditionEvaluator(surface);
  });

  afterEach(async () => {
    await resources.close();
    surface.dispose();
  });

  const options = {
    timeoutMs: 1000,
    pollIntervalMs: 20,
  };

  it('evaluates all six condition types with structured evidence', async () => {
    await resources.page.setContent(`
      <main data-surface-ready="true">
        <h1>Member Search</h1>
        <label for="member-name">Member Name</label>
        <input id="member-name" value="Alex Morgan">
        <button id="search">Search</button>
      </main>
    `);

    const conditions = [
      {
        kind: 'elementVisible',
        target: cssTarget('Search button', '#search'),
      },
      {
        kind: 'elementAbsent',
        target: cssTarget('Missing error', '#missing-error'),
      },
      {
        kind: 'textPresent',
        text: 'member search',
        match: 'contains',
        caseSensitive: false,
      },
      {
        kind: 'urlMatches',
        match: {
          kind: 'exact',
          value: 'about:blank',
        },
      },
      {
        kind: 'valueEquals',
        target: cssTarget('Member name input', '#member-name'),
        expected: 'Alex Morgan',
      },
      {
        kind: 'loadingComplete',
      },
    ] as const;

    for (const [index, condition] of conditions.entries()) {
      const result = await evaluator.evaluate(
        {
          conditionId: `condition-${index}`,
          condition,
        },
        options,
      );

      expect(result).toMatchObject({
        status: 'passed',
        passed: true,
        conditionId: `condition-${index}`,
      });

      expect(result.expected).not.toBeNull();
      expect(result.observed).not.toBeNull();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.attempts).toBeGreaterThan(0);
      expect(result.startedAt).toEqual(expect.any(String));
      expect(result.finishedAt).toEqual(expect.any(String));
    }
  });

  it('re-resolves a target while polling until it appears', async () => {
    await resources.page.setContent('<main data-surface-ready="true"></main>');

    let finishFirstResolution: (() => void) | undefined;

    const firstResolutionFinished = new Promise<void>((resolve) => {
      finishFirstResolution = resolve;
    });

    const originalResolveTarget = surface.resolveTarget.bind(surface);

    let resolutionCalls = 0;

    vi.spyOn(surface, 'resolveTarget').mockImplementation(async (request, operation) => {
      const result = await originalResolveTarget(request, operation);

      resolutionCalls += 1;

      if (resolutionCalls === 1) {
        finishFirstResolution?.();
      }

      return result;
    });

    const evaluation = evaluator.evaluate(
      {
        conditionId: 'eventual-button-visible',
        condition: {
          kind: 'elementVisible',
          target: cssTarget('Eventual button', '#eventual-button'),
        },
      },
      {
        timeoutMs: 3000,
        pollIntervalMs: 20,
      },
    );

    // First resolution must confirm zero matches before the button is added.
    await firstResolutionFinished;

    await resources.page.evaluate(() => {
      const button = document.createElement('button');
      button.id = 'eventual-button';
      button.textContent = 'Continue';
      document.body.append(button);
    });

    const result = await evaluation;

    expect(result).toMatchObject({
      status: 'passed',
      passed: true,
    });

    expect(result.attempts).toBeGreaterThan(1);
    expect(resolutionCalls).toBeGreaterThan(1);
  });

  it('does not treat an ambiguous target as absent', async () => {
    await resources.page.setContent(`
      <p class="error">A</p>
      <p class="error">B</p>
    `);

    const result = await evaluator.evaluate(
      {
        conditionId: 'error-absent',
        condition: {
          kind: 'elementAbsent',
          target: cssTarget('Error message', '.error'),
        },
      },
      options,
    );

    expect(result).toMatchObject({
      status: 'error',
      passed: false,
      error: {
        code: 'TARGET_AMBIGUOUS',
      },
    });
  });
});
