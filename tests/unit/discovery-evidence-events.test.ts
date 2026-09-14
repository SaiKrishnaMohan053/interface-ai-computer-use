import { describe, expect, it } from 'vitest';

import {
  DISCOVERY_EVIDENCE_EVENT_NAMES,
  parseDiscoveryEvidenceEvent,
  recordDiscoveryEvidenceEvent,
} from '../../src/discovery/index.js';

import type { RecordEventInput } from '../../src/evidence/index.js';

describe('Discovery evidence events', () => {
  it('defines the bounded discovery lifecycle vocabulary', () => {
    expect(DISCOVERY_EVIDENCE_EVENT_NAMES).toEqual(
      expect.arrayContaining([
        'discovery.started',
        'observation.captured',
        'model.decision.requested',
        'model.decision.received',
        'model.decision.invalid',
        'policy.evaluated',
        'target.resolved',
        'action.started',
        'action.completed',
        'action.failed',
        'value.extracted',
        'stuck.detected',
        'discovery.completed',
        'discovery.failed',
        'discovery.escalated',
      ]),
    );
  });

  it('records a validated event with screenshot references', async () => {
    const events: RecordEventInput[] = [];

    await recordDiscoveryEvidenceEvent(
      {
        recordEvent(input) {
          events.push(input);
          return Promise.resolve();
        },
      },
      {
        name: 'observation.captured',
        step: 2,
        observationId: 'observation-2',
        loading: 'complete',
        controlCount: 4,
        dialogCount: 0,
        evidenceRefs: [
          {
            evidenceId: 'screenshot-1',
            runId: 'run-1',
            kind: 'screenshot',
            relativePath: 'run-1/screenshots/screenshot-0001.png',
            mediaType: 'image/png',
            capturedAt: '2026-09-14T20:00:00.000Z',
          },
        ],
      },
    );

    expect(events).toMatchObject([
      {
        step: 2,
        eventType: 'observation.captured',
        result: {
          name: 'observation.captured',
        },
        evidenceRefs: [
          {
            kind: 'screenshot',
          },
        ],
      },
    ]);
  });

  it('records extraction identity without persisting its value', () => {
    expect(
      parseDiscoveryEvidenceEvent({
        name: 'value.extracted',
        step: 3,
        outputName: 'savingsBalance',
        source: 'surface_read',
        evidenceRefs: [],
      }),
    ).toEqual({
      name: 'value.extracted',
      step: 3,
      outputName: 'savingsBalance',
      source: 'surface_read',
      evidenceRefs: [],
    });
  });

  it('rejects provider payloads, secrets, prompts, and hidden reasoning fields', () => {
    for (const forbidden of [
      {
        apiKey: 'secret',
      },
      {
        rawResponse: {
          id: 'response-1',
        },
      },
      {
        prompt: 'full model prompt',
      },
      {
        chainOfThought: 'hidden reasoning',
      },
    ]) {
      expect(() =>
        parseDiscoveryEvidenceEvent({
          name: 'model.decision.received',
          step: 1,
          decisionKind: 'read',
          attempts: 1,
          ...forbidden,
        }),
      ).toThrow();
    }
  });
});
