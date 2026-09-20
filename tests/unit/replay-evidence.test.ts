import { describe, expect, it, vi } from 'vitest';

import {
  REPLAY_EVIDENCE_EVENT_TYPES,
  recordReplayEvidence,
  sanitizeReplayEvidenceDetails,
  sanitizeReplayEvidenceValue,
} from '../../src/replay/index.js';

import type { ReplayEvidenceEvent, ReplayEvidenceSink } from '../../src/replay/index.js';

function sink() {
  return {
    recordEvent: vi.fn<(event: ReplayEvidenceEvent) => Promise<void>>(() => Promise.resolve()),

    persistCapturedEvidence: vi.fn<ReplayEvidenceSink['persistCapturedEvidence']>(() =>
      Promise.reject(new Error('not used in structured-event tests')),
    ),
  } satisfies ReplayEvidenceSink;
}

describe('replay evidence', () => {
  it('defines the complete replay event vocabulary', () => {
    expect(REPLAY_EVIDENCE_EVENT_TYPES).toEqual([
      'replay.started',
      'artifact.loaded',
      'inputs.validated',
      'step.started',
      'policy.evaluated',
      'target.resolved',
      'precondition.passed',
      'action.completed',
      'output.extracted',
      'postcondition.passed',
      'business_outcome.detected',
      'recovery.started',
      'recovery.attempted',
      'recovery.succeeded',
      'recovery.exhausted',
      'success_condition.passed',
      'replay.completed',
      'replay.failed',
      'replay.intervention_required',
    ]);
  });

  it('records replay-specific structured events', async () => {
    const evidenceSink = sink();

    await recordReplayEvidence({
      sink: evidenceSink,

      eventType: 'step.started',

      step: 2,

      stepId: 'open-accounts',

      details: {
        actionKind: 'click',
      },
    });

    expect(evidenceSink.recordEvent).toHaveBeenCalledTimes(1);

    expect(evidenceSink.recordEvent).toHaveBeenCalledWith({
      eventType: 'step.started',

      step: 2,

      stepId: 'open-accounts',

      details: {
        actionKind: 'click',
      },

      evidenceRefs: [],
    });
  });

  it('redacts sensitive keys before persistence', () => {
    const result = sanitizeReplayEvidenceDetails({
      stepId: 'step-1',

      password: 'super-secret',

      apiKey: 'example-key',

      cookie: 'session=value',

      nested: {
        authorization: 'Bearer abc123',
      },
    });

    expect(result).toEqual({
      stepId: 'step-1',

      password: '[REDACTED]',

      apiKey: '[REDACTED]',

      cookie: '[REDACTED]',

      nested: {
        authorization: '[REDACTED]',
      },
    });
  });

  it('redacts secret-like bearer values even when the key is generic', () => {
    const result = sanitizeReplayEvidenceValue('request failed with Bearer abc.def.ghi');

    expect(result).toBe('request failed with [REDACTED]');
  });

  it('bounds persisted string values', () => {
    const input = 'x'.repeat(5_000);

    const result = sanitizeReplayEvidenceValue(input);

    expect(typeof result).toBe('string');

    if (typeof result === 'string') {
      expect(result.length).toBe(2_000);
    }
  });

  it('sanitizes nested arrays and objects recursively', () => {
    const result = sanitizeReplayEvidenceDetails({
      values: [
        {
          token: 'abc',
          state: 'ok',
        },

        'Bearer xyz',
      ],
    });

    expect(result).toEqual({
      values: [
        {
          token: '[REDACTED]',
          state: 'ok',
        },

        '[REDACTED]',
      ],
    });
  });

  it('preserves persisted evidence references without embedding raw evidence', async () => {
    const evidenceSink = sink();

    const reference = {
      evidenceId: 'evidence-1',
      runId: 'run-1',
      kind: 'screenshot',
      relativePath: 'screenshots/failure.png',
      mediaType: 'image/png',
      capturedAt: '2026-09-20T21:00:00.000Z',
    } as const;

    await recordReplayEvidence({
      sink: evidenceSink,

      eventType: 'replay.failed',

      step: 4,

      stepId: 'read-savings-balance',

      details: {
        code: 'ACTION_FAILED',
      },

      evidenceRefs: [reference],
    });

    expect(evidenceSink.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        evidenceRefs: [reference],
      }),
    );
  });

  it('rejects negative event step indexes', async () => {
    const evidenceSink = sink();

    await expect(
      recordReplayEvidence({
        sink: evidenceSink,

        eventType: 'replay.started',

        step: -1,
      }),
    ).rejects.toThrow('Replay evidence step must be a non-negative integer');
  });

  it('does not invoke raw evidence persistence for a normal structured event', async () => {
    const evidenceSink = sink();

    await recordReplayEvidence({
      sink: evidenceSink,

      eventType: 'policy.evaluated',

      step: 1,

      details: {
        decision: 'ALLOW',
      },
    });

    expect(evidenceSink.persistCapturedEvidence).not.toHaveBeenCalled();
  });
});
