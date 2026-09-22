import type { ActionResult, SurfaceAdapter } from '../surface/index.js';

import type { TargetStrategy } from '../targeting/index.js';

type ReplayPerformRequest = Parameters<SurfaceAdapter<TargetStrategy>['perform']>[0];

type ReplayPerformOptions = Parameters<SurfaceAdapter<TargetStrategy>['perform']>[1];

export interface ReplayOwnedActionInput {
  readonly surface: Pick<SurfaceAdapter<TargetStrategy>, 'perform'>;
  readonly request: ReplayPerformRequest;
  readonly options: ReplayPerformOptions;

  /**
   * Synchronously verifies that REPLAY still owns an ACTIVE
   * session immediately before the browser operation begins.
   */
  readonly assertAutomationOwnership: () => void;
}

export type ReplayOwnedActionResult =
  | {
      readonly status: 'executed';
      readonly result: ActionResult;
    }
  | {
      readonly status: 'ownership_blocked';
      readonly message: string;
    };

/**
 * Final replay browser-action boundary.
 *
 * Ownership is checked immediately before SurfaceAdapter.perform().
 * Once perform() has started, that one in-flight operation is allowed
 * to settle. Every later automated action must pass this boundary again.
 */
export async function performReplayOwnedAction(
  input: ReplayOwnedActionInput,
): Promise<ReplayOwnedActionResult> {
  try {
    input.assertAutomationOwnership();
  } catch (error) {
    return {
      status: 'ownership_blocked',
      message:
        error instanceof Error
          ? `Replay lost session ownership before action execution: ${error.message}`
          : 'Replay lost session ownership before action execution.',
    };
  }

  const result = await input.surface.perform(input.request, input.options);

  return {
    status: 'executed',
    result,
  };
}
