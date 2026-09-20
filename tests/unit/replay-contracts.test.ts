import { describe, expect, it } from 'vitest';

import {
  parseReplayRequest,
  parseReplayResult,
  replayRequestSchema,
} from '../../src/replay/index.js';

describe('replay domain contracts', () => {
  describe('ReplayRequest', () => {
    it('accepts a valid deterministic replay request', () => {
      const result = parseReplayRequest({
        capabilityId: 'lookup_savings_balance',
        version: '1.0.0',
        inputs: {
          memberName: 'Alex Morgan',
        },
        target: {
          entryUrl: 'http://127.0.0.1:3000/member-search',
        },
        options: {
          timeoutMs: 30_000,
        },
      });

      expect(result).toEqual({
        capabilityId: 'lookup_savings_balance',
        version: '1.0.0',
        inputs: {
          memberName: 'Alex Morgan',
        },
        target: {
          entryUrl: 'http://127.0.0.1:3000/member-search',
        },
        options: {
          timeoutMs: 30_000,
        },
      });
    });

    it('allows target and options to be omitted', () => {
      const result = parseReplayRequest({
        capabilityId: 'lookup_savings_balance',
        version: '1.0.0',
        inputs: {
          memberName: 'Alex Morgan',
        },
      });

      expect(result.capabilityId).toBe('lookup_savings_balance');
      expect(result.version).toBe('1.0.0');
    });

    it('rejects malformed capability identifiers', () => {
      const result = replayRequestSchema.safeParse({
        capabilityId: '../lookup_savings_balance',
        version: '1.0.0',
        inputs: {},
      });

      expect(result.success).toBe(false);
    });

    it('rejects malformed capability versions', () => {
      const result = replayRequestSchema.safeParse({
        capabilityId: 'lookup_savings_balance',
        version: 'v1',
        inputs: {},
      });

      expect(result.success).toBe(false);
    });

    it('rejects non-http replay entry URLs', () => {
      const result = replayRequestSchema.safeParse({
        capabilityId: 'lookup_savings_balance',
        version: '1.0.0',
        inputs: {},
        target: {
          entryUrl: 'file:///etc/passwd',
        },
      });

      expect(result.success).toBe(false);
    });

    it('rejects replay entry URLs containing credentials', () => {
      const result = replayRequestSchema.safeParse({
        capabilityId: 'lookup_savings_balance',
        version: '1.0.0',
        inputs: {},
        target: {
          entryUrl: 'https://user:password@example.com/member-search',
        },
      });

      expect(result.success).toBe(false);
    });

    it('rejects model configuration fields', () => {
      const result = replayRequestSchema.safeParse({
        capabilityId: 'lookup_savings_balance',
        version: '1.0.0',
        inputs: {},
        model: 'gpt-5',
      });

      expect(result.success).toBe(false);
    });

    it('rejects provider configuration fields', () => {
      const result = replayRequestSchema.safeParse({
        capabilityId: 'lookup_savings_balance',
        version: '1.0.0',
        inputs: {},
        provider: 'openai',
      });

      expect(result.success).toBe(false);
    });

    it('rejects a non-positive run timeout', () => {
      const result = replayRequestSchema.safeParse({
        capabilityId: 'lookup_savings_balance',
        version: '1.0.0',
        inputs: {},
        options: {
          timeoutMs: 0,
        },
      });

      expect(result.success).toBe(false);
    });
  });

  describe('ReplayResult', () => {
    const baseResult = {
      runId: 'replay-run-1',
      sessionId: 'session-1',
      startedAt: '2026-09-20T12:00:00.000-05:00',
      finishedAt: '2026-09-20T12:00:01.000-05:00',
      durationMs: 1000,
      evidenceRefs: [],
      recoverableConditions: [],
    };

    it('uses the canonical runtime success contract', () => {
      const result = parseReplayResult({
        ...baseResult,
        status: 'success',
        outputs: {
          savingsBalance: '$12,840.50',
        },
      });

      expect(result.status).toBe('success');

      if (result.status === 'success') {
        expect(result.outputs.savingsBalance).toBe('$12,840.50');
      }
    });

    it('uses the canonical runtime business-outcome contract', () => {
      const result = parseReplayResult({
        ...baseResult,
        status: 'business_outcome',
        outcome: {
          code: 'MEMBER_NOT_FOUND',
          message: 'No member matched the supplied lookup input.',
          details: {},
        },
      });

      expect(result.status).toBe('business_outcome');

      if (result.status === 'business_outcome') {
        expect(result.outcome.code).toBe('MEMBER_NOT_FOUND');
      }
    });

    it('uses the canonical runtime intervention contract', () => {
      const result = parseReplayResult({
        ...baseResult,
        status: 'intervention_required',
        intervention: {
          interventionId: 'intervention-1',
          code: 'HUMAN_APPROVAL_REQUIRED',
          message: 'Human approval is required.',
          requestedOwner: 'HUMAN',
          resumable: true,
          context: {
            stepId: 'submit-member-search',
          },
        },
      });

      expect(result.status).toBe('intervention_required');
    });

    it('accepts output extraction failure with debugging context', () => {
      const result = parseReplayResult({
        ...baseResult,
        status: 'failure',
        error: {
          code: 'OUTPUT_EXTRACTION_FAILED',
          message: 'Required replay output could not be extracted.',
          stepId: 'read-savings-balance',
          expected: {
            output: 'savingsBalance',
            type: 'currency',
          },
          observed: null,
          details: {
            recoverability: 'not_recoverable',
          },
        },
      });

      expect(result.status).toBe('failure');

      if (result.status === 'failure') {
        expect(result.error.code).toBe('OUTPUT_EXTRACTION_FAILED');
        expect(result.error.stepId).toBe('read-savings-balance');
        expect(result.error.expected).toEqual({
          output: 'savingsBalance',
          type: 'currency',
        });
        expect(result.error.observed).toBeNull();
        expect(result.error.details.recoverability).toBe('not_recoverable');
      }
    });

    it('retains evidence references on a replay failure', () => {
      const result = parseReplayResult({
        ...baseResult,
        status: 'failure',
        evidenceRefs: [
          {
            evidenceId: 'evidence-1',
            runId: 'replay-run-1',
            kind: 'screenshot',
            relativePath: 'screenshots/failure.png',
            mediaType: 'image/png',
            capturedAt: '2026-09-20T12:00:00.900-05:00',
          },
        ],
        error: {
          code: 'CHECKPOINT_FAILED',
          message: 'Replay checkpoint did not pass.',
          stepId: 'submit-member-search',
          expected: 'Member Details',
          observed: 'Member Search',
          details: {
            phase: 'postcondition',
            recoverability: 'not_recoverable',
          },
        },
      });

      expect(result.status).toBe('failure');
      expect(result.evidenceRefs).toHaveLength(1);
      expect(result.evidenceRefs[0]?.kind).toBe('screenshot');
    });
  });
});
