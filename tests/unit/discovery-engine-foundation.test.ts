import { describe, expect, it } from 'vitest';

import { agentActionOutcomeSchema } from '../../src/discovery/index.js';

describe('discovery engine foundation', () => {
  it.each(['click', 'type', 'select', 'check', 'uncheck', 'navigate', 'read', 'wait', 'dismiss'])(
    'supports recent outcome for %s',
    (actionKind) => {
      const result = agentActionOutcomeSchema.safeParse({
        status: 'success',
        actionKind,
        summary: 'Action completed',
        output: null,
      });

      expect(result.success).toBe(true);
    },
  );

  it('rejects the obsolete dismiss_dialog action name', () => {
    const result = agentActionOutcomeSchema.safeParse({
      status: 'success',
      actionKind: 'dismiss_dialog',
      summary: 'Action completed',
      output: null,
    });

    expect(result.success).toBe(false);
  });
});
