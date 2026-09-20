import { describe, expect, it } from 'vitest';

import { mapReplayFailure } from '../../src/replay/index.js';

import type { SurfaceFailure } from '../../src/surface/index.js';

function failure(code: SurfaceFailure['code']): SurfaceFailure {
  return {
    code,

    message: `Surface failure: ${code}`,

    expected: 'expected-state',

    observed: 'observed-state',
  };
}

describe('replay failure mapper', () => {
  it('maps navigation failures to NAVIGATION_FAILED', () => {
    const result = mapReplayFailure({
      phase: 'navigation',

      stepId: 'navigate-step',

      failure: failure('NAVIGATION_FAILED'),
    });

    expect(result.code).toBe('NAVIGATION_FAILED');

    expect(result.details.stepId).toBe('navigate-step');
  });

  it('maps action failures to ACTION_FAILED', () => {
    const result = mapReplayFailure({
      phase: 'action',

      stepId: 'click-step',

      failure: failure('ACTION_FAILED'),
    });

    expect(result.code).toBe('ACTION_FAILED');
  });

  it('preserves TARGET_NOT_FOUND during target resolution', () => {
    const result = mapReplayFailure({
      phase: 'target_resolution',

      stepId: 'read-step',

      failure: failure('TARGET_NOT_FOUND'),
    });

    expect(result.code).toBe('TARGET_NOT_FOUND');
  });

  it('preserves TARGET_AMBIGUOUS during target resolution', () => {
    const result = mapReplayFailure({
      phase: 'target_resolution',

      stepId: 'read-step',

      failure: failure('TARGET_AMBIGUOUS'),
    });

    expect(result.code).toBe('TARGET_AMBIGUOUS');
  });

  it('does not silently treat an unknown target-resolution surface failure as target absence', () => {
    const result = mapReplayFailure({
      phase: 'target_resolution',

      stepId: 'read-step',

      failure: failure('ACTION_FAILED'),
    });

    expect(result.code).toBe('ACTION_FAILED');

    expect(result.details.reason).toBe('TARGET_RESOLUTION_FAILURE');
  });

  it('maps checkpoint failures to CHECKPOINT_FAILED', () => {
    const result = mapReplayFailure({
      phase: 'checkpoint',

      stepId: 'accounts-step',

      failure: failure('CONDITION_EVALUATION_FAILED'),
    });

    expect(result.code).toBe('CHECKPOINT_FAILED');
  });

  it('maps output extraction failure to ACTION_FAILED without inventing a new runtime code', () => {
    const result = mapReplayFailure({
      phase: 'output_extraction',

      stepId: 'read-savings-balance',

      failure: failure('ACTION_FAILED'),
    });

    expect(result.code).toBe('ACTION_FAILED');

    expect(result.details.reason).toBe('OUTPUT_EXTRACTION_FAILED');
  });

  it('preserves expected and observed values from the underlying surface failure', () => {
    const result = mapReplayFailure({
      phase: 'action',

      stepId: 'step-1',

      failure: failure('ACTION_FAILED'),
    });

    expect(result.expected).toBe('expected-state');

    expect(result.observed).toBe('observed-state');
  });

  it('records original surface failure code in details', () => {
    const result = mapReplayFailure({
      phase: 'checkpoint',

      stepId: 'step-1',

      failure: failure('CONDITION_TIMEOUT'),
    });

    expect(result.details.surfaceFailureCode).toBe('CONDITION_TIMEOUT');
  });
});
