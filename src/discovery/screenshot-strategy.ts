export const DISCOVERY_SCREENSHOT_EVIDENCE_MODES = ['none', 'synthetic_fixture'] as const;

export type DiscoveryScreenshotEvidenceMode = (typeof DISCOVERY_SCREENSHOT_EVIDENCE_MODES)[number];

export const DISCOVERY_SCREENSHOT_PURPOSES = [
  'initial_state',
  'navigation_transition',
  'step_observation',
] as const;

export type DiscoveryScreenshotPurpose = (typeof DISCOVERY_SCREENSHOT_PURPOSES)[number];

export interface DiscoveryScreenshotPlanInput {
  readonly evidenceMode: DiscoveryScreenshotEvidenceMode;
  readonly step: number;
  readonly recentActionKind?: string | null;
}

export interface DiscoveryScreenshotPlan {
  readonly purpose: DiscoveryScreenshotPurpose;
  readonly extent: 'viewport';
  readonly dataHandling: 'SYNTHETIC_FIXTURE_ONLY';
}

/**
 * Captures one bounded screenshot per structured observation only when the
 * run explicitly declares synthetic fixture data. There is no timer-based or
 * background capture, and production persistence remains disabled by default.
 */
export function planDiscoveryObservationScreenshot(
  input: DiscoveryScreenshotPlanInput,
): DiscoveryScreenshotPlan | null {
  if (input.evidenceMode === 'none') return null;

  if (!Number.isInteger(input.step) || input.step < 1) {
    throw new RangeError('Screenshot step must be a positive integer');
  }

  const purpose: DiscoveryScreenshotPurpose =
    input.step === 1
      ? 'initial_state'
      : input.recentActionKind === 'navigate'
        ? 'navigation_transition'
        : 'step_observation';

  return {
    purpose,
    extent: 'viewport',
    dataHandling: 'SYNTHETIC_FIXTURE_ONLY',
  };
}
