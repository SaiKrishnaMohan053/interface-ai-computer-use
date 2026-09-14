import { describe, expect, it } from 'vitest';

import {
  discoveryDecisionRationale,
  parseDiscoveryTraceRecord,
  recordDiscoveryTrace,
} from '../../src/discovery/index.js';

import type { RecordEventInput } from '../../src/evidence/index.js';

describe('DiscoveryTrace', () => {
  it('records concise model rationale', () => {
    const decision = {
      kind: 'read' as const,

      target: {
        description: 'Savings current balance',

        strategies: [
          {
            kind: 'text' as const,
            text: {
              value: '$12,840.50',
              mode: 'exact' as const,
              caseSensitive: true,
            },
          },
        ],

        cardinality: 'exactly-one' as const,
      },

      source: 'text' as const,
      saveAs: 'savingsBalance',
      reason: 'Read the visible Savings balance',
    };

    expect(
      parseDiscoveryTraceRecord({
        kind: 'model_decision',
        step: 3,
        decision,
        rationale: discoveryDecisionRationale(decision),
      }),
    ).toMatchObject({
      kind: 'model_decision',
      rationale: 'Read the visible Savings balance',
    });
  });

  it('records extracted values and screenshot references', () => {
    expect(
      parseDiscoveryTraceRecord({
        kind: 'action_result',
        step: 3,
        actionKind: 'read',
        status: 'success',
        errorCode: null,

        extractedValues: {
          savingsBalance: '$12,840.50',
        },

        evidenceRefs: [
          {
            evidenceId: 'screenshot-1',
            runId: 'run-1',
            kind: 'screenshot',

            relativePath: 'run-1/screenshots/screenshot-0001.png',

            mediaType: 'image/png',

            capturedAt: '2026-09-14T19:00:00.000Z',
          },
        ],
      }),
    ).toMatchObject({
      status: 'success',

      extractedValues: {
        savingsBalance: '$12,840.50',
      },

      evidenceRefs: [
        {
          kind: 'screenshot',
        },
      ],
    });
  });

  it('records target-resolution result', () => {
    expect(
      parseDiscoveryTraceRecord({
        kind: 'target_resolution',
        step: 3,

        targetDescription: 'Savings current balance',

        status: 'resolved',

        attempts: [
          {
            strategyIndex: 0,
            strategyKind: 'structural',
            outcome: 'resolved',
            matchCount: 1,
          },
        ],

        errorCode: null,
      }),
    ).toMatchObject({
      kind: 'target_resolution',
      status: 'resolved',
    });
  });

  it('rejects provider data and chain-of-thought', () => {
    expect(() =>
      parseDiscoveryTraceRecord({
        kind: 'runtime_event',
        step: 1,
        status: 'success',
        summary: 'Completed',

        rawOpenAIResponse: {
          id: 'response-1',
        },
      }),
    ).toThrow();

    expect(() =>
      parseDiscoveryTraceRecord({
        kind: 'runtime_event',
        step: 1,
        status: 'success',
        summary: 'Completed',

        chainOfThought: 'hidden reasoning',
      }),
    ).toThrow();
  });

  it('writes validated records as evidence', async () => {
    const events: RecordEventInput[] = [];

    await recordDiscoveryTrace(
      {
        recordEvent(input) {
          events.push(input);
          return Promise.resolve();
        },
      },
      {
        kind: 'runtime_event',
        step: 4,
        status: 'success',
        summary: 'Discovery completed',
      },
    );

    expect(events).toEqual([
      {
        step: 4,
        eventType: 'discovery_trace',

        result: {
          kind: 'runtime_event',
          step: 4,
          status: 'success',
          summary: 'Discovery completed',
        },

        evidenceRefs: [],
      },
    ]);
  });
});
