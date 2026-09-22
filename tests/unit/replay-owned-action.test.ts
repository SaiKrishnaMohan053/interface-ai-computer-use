import { describe, expect, it, vi } from 'vitest';

import { performReplayOwnedAction } from '../../src/replay/index.js';

import type { ActionResult, SurfaceAdapter } from '../../src/surface/index.js';

import type { TargetStrategy } from '../../src/targeting/index.js';

type Perform = SurfaceAdapter<TargetStrategy>['perform'];

function successResult(): ActionResult {
  return {
    sessionId: 'session-1',
    surfaceId: 'surface-1',
    status: 'success',
    actionId: 'action-1',
    startedAt: '2026-09-22T20:00:00.000Z',
    finishedAt: '2026-09-22T20:00:00.001Z',
    durationMs: 1,
    evidenceRefs: [],
    output: {
      kind: 'none',
    },
  };
}

describe('replay owned action boundary', () => {
  it('allows replay when REPLAY owns the active session', async () => {
    let state: 'ACTIVE' | 'PAUSED' = 'ACTIVE';
    let owner: 'REPLAY' | 'HUMAN' = 'REPLAY';

    const perform = vi.fn<Perform>().mockResolvedValue(successResult());

    const result = await performReplayOwnedAction({
      surface: { perform },
      assertAutomationOwnership: () => {
        if (state !== 'ACTIVE' || owner !== 'REPLAY') {
          throw new Error('REPLAY does not own an active session');
        }
      },
      request: {
        actionId: 'action-1',
        action: {
          kind: 'navigate',
          destination: 'http://example.test',
        },
      },
      options: {
        timeoutMs: 1_000,
      },
    });

    expect(result.status).toBe('executed');
    expect(perform).toHaveBeenCalledTimes(1);

    state = 'PAUSED';
    owner = 'HUMAN';
  });

  it('blocks replay before perform when HUMAN owns the session', async () => {
    const perform = vi.fn<Perform>().mockResolvedValue(successResult());

    const result = await performReplayOwnedAction({
      surface: { perform },
      assertAutomationOwnership: () => {
        throw new Error('Expected owner REPLAY, received HUMAN');
      },
      request: {
        actionId: 'action-1',
        action: {
          kind: 'navigate',
          destination: 'http://example.test',
        },
      },
      options: {
        timeoutMs: 1_000,
      },
    });

    expect(result.status).toBe('ownership_blocked');
    expect(perform).not.toHaveBeenCalled();
  });

  it('checks ownership immediately before each replay browser action', async () => {
    let owner: 'REPLAY' | 'HUMAN' = 'REPLAY';
    const order: string[] = [];

    const perform = vi.fn<Perform>().mockImplementation(() => {
      order.push('perform');
      return Promise.resolve(successResult());
    });

    const assertAutomationOwnership = () => {
      order.push('ownership');

      if (owner !== 'REPLAY') {
        throw new Error('Replay ownership lost');
      }
    };

    const first = await performReplayOwnedAction({
      surface: { perform },
      assertAutomationOwnership,
      request: {
        actionId: 'action-1',
        action: {
          kind: 'navigate',
          destination: 'http://example.test',
        },
      },
      options: {
        timeoutMs: 1_000,
      },
    });

    expect(first.status).toBe('executed');
    expect(order).toEqual(['ownership', 'perform']);

    owner = 'HUMAN';

    const second = await performReplayOwnedAction({
      surface: { perform },
      assertAutomationOwnership,
      request: {
        actionId: 'action-2',
        action: {
          kind: 'navigate',
          destination: 'http://example.test/next',
        },
      },
      options: {
        timeoutMs: 1_000,
      },
    });

    expect(second.status).toBe('ownership_blocked');
    expect(perform).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['ownership', 'perform', 'ownership']);
  });

  it('lets an in-flight action settle and blocks the next action after HUMAN takeover', async () => {
    let owner: 'REPLAY' | 'HUMAN' = 'REPLAY';
    let resolvePerform: ((result: ActionResult) => void) | undefined;

    const perform = vi.fn<Perform>().mockImplementation(
      () =>
        new Promise<ActionResult>((resolve) => {
          resolvePerform = resolve;
        }),
    );

    const assertAutomationOwnership = () => {
      if (owner !== 'REPLAY') {
        throw new Error('Replay ownership lost');
      }
    };

    const inFlight = performReplayOwnedAction({
      surface: { perform },
      assertAutomationOwnership,
      request: {
        actionId: 'action-1',
        action: {
          kind: 'navigate',
          destination: 'http://example.test',
        },
      },
      options: {
        timeoutMs: 1_000,
      },
    });

    expect(perform).toHaveBeenCalledTimes(1);

    owner = 'HUMAN';

    if (resolvePerform === undefined) {
      throw new Error('Expected replay action to be in flight');
    }

    resolvePerform(successResult());

    await expect(inFlight).resolves.toMatchObject({
      status: 'executed',
    });

    const next = await performReplayOwnedAction({
      surface: { perform },
      assertAutomationOwnership,
      request: {
        actionId: 'action-2',
        action: {
          kind: 'navigate',
          destination: 'http://example.test/next',
        },
      },
      options: {
        timeoutMs: 1_000,
      },
    });

    expect(next.status).toBe('ownership_blocked');
    expect(perform).toHaveBeenCalledTimes(1);
  });
});
