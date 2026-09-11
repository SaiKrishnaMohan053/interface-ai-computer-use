import { describe, expect, it } from 'vitest';

import {
  DISCOVERY_HISTORY_SUMMARY_LIMIT,
  DISCOVERY_MODEL_HISTORY_LIMIT,
  buildDiscoveryModelContext,
  createDiscoveryModelInput,
  parseAgentObservation,
} from '../../src/discovery/index.js';

import type { DiscoveryHistoryEntry } from '../../src/discovery/index.js';

const observation = parseAgentObservation({
  goal: "Read Alex Morgan's Savings balance",
  step: 6,

  observationId: 'observation-6',
  capturedAt: '2026-09-11T16:00:00.000Z',

  location: {
    kind: 'web',
    url: 'https://bank.test/member/alex/accounts',
    title: 'Alex Morgan Accounts',
  },

  visibleTextSummary: 'Alex Morgan\nSavings\nCurrent Balance\n$12,840.50',

  controls: [],
  dialogs: [],

  contextHints: {
    frames: ['Top-level document'],
    regions: ['Accounts table'],
  },

  loading: 'complete',

  truncated: {
    visibleText: false,
    controls: false,
  },

  extractedValues: {
    savingsBalance: '$12,840.50',
  },

  recentAction: {
    status: 'success',
    actionKind: 'click',
    summary: 'Opened the Accounts view.',
    output: null,
  },

  recentCondition: {
    status: 'passed',
    conditionKind: 'textPresent',
    summary: 'Savings balance is visible.',
  },

  recentError: null,
});

function historyEntry(step: number): DiscoveryHistoryEntry {
  return {
    step,
    decisionKind: 'click',
    outcome: 'success',
    summary: `Completed action at step ${step}`,
  };
}

describe('discovery model input', () => {
  it('creates a compact context with explicit goal and step', () => {
    const context = buildDiscoveryModelContext({
      observation,
      history: [historyEntry(5)],
    });

    expect(context.goal).toBe("Read Alex Morgan's Savings balance");
    expect(context.step).toBe(6);

    expect(context.currentObservation).not.toHaveProperty('goal');
    expect(context.currentObservation).not.toHaveProperty('step');
    expect(context.currentObservation).not.toHaveProperty('recentAction');

    expect(context.recent.action).toEqual(observation.recentAction);
    expect(context.recent.condition).toEqual(observation.recentCondition);
  });

  it('keeps only the latest five history entries', () => {
    const history = Array.from(
      {
        length: 8,
      },
      (_, index) => historyEntry(index + 1),
    );

    const context = buildDiscoveryModelContext({
      observation,
      history,
    });

    expect(context.history).toHaveLength(DISCOVERY_MODEL_HISTORY_LIMIT);

    expect(context.history.map((entry) => entry.step)).toEqual([4, 5, 6, 7, 8]);
  });

  it('supports an empty history on the first model call', () => {
    const input = createDiscoveryModelInput({
      observation,
    });

    expect(input.history).toEqual([]);

    expect(buildDiscoveryModelContext(input).history).toEqual([]);
  });

  it('bounds long history summaries', () => {
    const context = buildDiscoveryModelContext({
      observation,
      history: [
        {
          step: 5,
          decisionKind: 'read',
          outcome: 'success',
          summary: 'x'.repeat(5_000),
        },
      ],
    });

    expect(context.history[0]?.summary).toHaveLength(DISCOVERY_HISTORY_SUMMARY_LIMIT);
  });

  it('sanitizes secrets in history summaries', () => {
    const context = buildDiscoveryModelContext({
      observation,
      history: [
        {
          step: 5,
          decisionKind: 'navigate',
          outcome: 'failure',
          summary: 'Request failed with authorization: Bearer history-secret',
        },
      ],
    });

    const serialized = JSON.stringify(context);

    expect(serialized).not.toContain('history-secret');
    expect(serialized).toContain('[REDACTED]');
  });

  it('does not preserve extra history transcript fields', () => {
    const unsafeEntry = {
      ...historyEntry(5),
      rawObservation: {
        rawDom: '<html>entire previous page</html>',
      },
      transcript: 'complete previous conversation',
      screenshot: 'base64-image-data',
    } as DiscoveryHistoryEntry;

    const context = buildDiscoveryModelContext({
      observation,
      history: [unsafeEntry],
    });

    const serialized = JSON.stringify(context);

    expect(serialized).not.toContain('rawObservation');
    expect(serialized).not.toContain('rawDom');
    expect(serialized).not.toContain('transcript');
    expect(serialized).not.toContain('screenshot');
    expect(serialized).not.toContain('base64-image-data');
  });

  it('retains concise action and outcome information', () => {
    const context = buildDiscoveryModelContext({
      observation,
      history: [
        {
          step: 3,
          decisionKind: 'type',
          outcome: 'success',
          summary: 'Entered the requested member name.',
        },
        {
          step: 4,
          decisionKind: 'click',
          outcome: 'success',
          summary: 'Submitted the visible search form.',
        },
        {
          step: 5,
          decisionKind: 'read',
          outcome: 'success',
          summary: 'Read the visible Savings balance.',
        },
      ],
    });

    expect(context.history).toEqual([
      {
        step: 3,
        decisionKind: 'type',
        outcome: 'success',
        summary: 'Entered the requested member name.',
      },
      {
        step: 4,
        decisionKind: 'click',
        outcome: 'success',
        summary: 'Submitted the visible search form.',
      },
      {
        step: 5,
        decisionKind: 'read',
        outcome: 'success',
        summary: 'Read the visible Savings balance.',
      },
    ]);
  });
});
