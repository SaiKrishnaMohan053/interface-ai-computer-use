import { describe, expect, it } from 'vitest';

import { LiveInterventionRegistry } from '../../src/intervention/index.js';

import type { CoordinatedRunContext } from '../../src/runtime/index.js';

function context(runId: string): CoordinatedRunContext<unknown> {
  return {
    runId,
    mode: 'DISCOVERY',
  } as unknown as CoordinatedRunContext<unknown>;
}

describe('LiveInterventionRegistry', () => {
  it('registers and returns the same live coordinated context', () => {
    const registry = new LiveInterventionRegistry();

    const liveContext = context('run-1');

    registry.register({
      interventionId: 'intervention-1',

      context: liveContext,
    });

    expect(registry.get('intervention-1')).toBe(liveContext);

    expect(registry.has('intervention-1')).toBe(true);

    expect(registry.listIds()).toEqual(['intervention-1']);
  });

  it('rejects duplicate live registration for the same intervention', () => {
    const registry = new LiveInterventionRegistry();

    registry.register({
      interventionId: 'intervention-1',

      context: context('run-1'),
    });

    expect(() =>
      registry.register({
        interventionId: 'intervention-1',

        context: context('run-2'),
      }),
    ).toThrow('Live intervention already registered: intervention-1');
  });

  it('fails explicitly when a live intervention is missing', () => {
    const registry = new LiveInterventionRegistry();

    expect(() => registry.get('missing')).toThrow(
      'No live intervention context registered: missing',
    );
  });

  it('removes a live intervention without closing or mutating its context', () => {
    const registry = new LiveInterventionRegistry();

    const liveContext = context('run-1');

    registry.register({
      interventionId: 'intervention-1',

      context: liveContext,
    });

    expect(registry.remove('intervention-1')).toBe(true);

    expect(registry.has('intervention-1')).toBe(false);

    expect(liveContext.runId).toBe('run-1');
  });

  it('rejects an empty intervention id', () => {
    const registry = new LiveInterventionRegistry();

    expect(() =>
      registry.register({
        interventionId: '   ',

        context: context('run-1'),
      }),
    ).toThrow('interventionId must not be empty');
  });
});
