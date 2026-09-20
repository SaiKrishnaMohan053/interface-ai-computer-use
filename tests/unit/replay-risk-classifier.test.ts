import { describe, expect, it } from 'vitest';

import {
  classifyReplayStepRisk,
  compareReplayRisk,
  maxReplayRisk,
} from '../../src/replay/index.js';

import type { CapabilityStep } from '../../src/artifact/index.js';

function step(
  action: CapabilityStep['action'],
  risk: CapabilityStep['risk'] = 'READ_ONLY',
): CapabilityStep {
  return {
    id: 'test-step',
    description: 'Test step.',
    action,
    risk,
  };
}

describe('replay runtime risk classification', () => {
  it('classifies read as READ_ONLY', () => {
    expect(
      classifyReplayStepRisk(
        step({
          kind: 'read',
          source: 'text',
          saveAs: {
            kind: 'outputRef',
            name: 'result',
          },
        }),
      ),
    ).toBe('READ_ONLY');
  });

  it('classifies click as READ_ONLY', () => {
    expect(
      classifyReplayStepRisk(
        step({
          kind: 'click',
        }),
      ),
    ).toBe('READ_ONLY');
  });

  it('classifies type as REVERSIBLE', () => {
    expect(
      classifyReplayStepRisk(
        step({
          kind: 'type',
          mode: 'replace',
          value: {
            kind: 'inputRef',
            name: 'memberName',
          },
        }),
      ),
    ).toBe('REVERSIBLE');
  });

  it('classifies select and checkbox mutations as REVERSIBLE', () => {
    expect(
      classifyReplayStepRisk(
        step({
          kind: 'check',
        }),
      ),
    ).toBe('REVERSIBLE');

    expect(
      classifyReplayStepRisk(
        step({
          kind: 'uncheck',
        }),
      ),
    ).toBe('REVERSIBLE');
  });

  it('orders risks without allowing silent downgrade', () => {
    expect(compareReplayRisk('REVERSIBLE', 'READ_ONLY')).toBeGreaterThan(0);

    expect(maxReplayRisk('READ_ONLY', 'REVERSIBLE')).toBe('REVERSIBLE');
  });
});
