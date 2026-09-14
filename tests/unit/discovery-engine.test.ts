import { describe, expect, it } from 'vitest';

import { PolicyEngine } from '../../src/policy/index.js';
import type { PolicyActionKind, PolicyDecisionKind } from '../../src/policy/index.js';
import type { CoordinatedRunContext, StartCoordinatedRunOptions } from '../../src/runtime/index.js';
import type {
  ActionExecutionRequest,
  ActionResult,
  ConditionEvaluationRequest,
  ConditionResult,
  ConditionWaitOptions,
  EvidenceCaptureRequest,
  EvidenceCaptureResult,
  ObservationOptions,
  ObservationResult,
  SurfaceAdapter,
  SurfaceFailure,
  SurfaceObservation,
  SurfaceOperationOptions,
  TargetResolutionRequest,
  TargetResolutionResult,
} from '../../src/surface/index.js';
import type { TargetStrategy } from '../../src/targeting/index.js';
import { DiscoveryEngine } from '../../src/discovery/index.js';
import type {
  DiscoveryCoordinator,
  DiscoveryDecision,
  DiscoveryDecisionModel,
  DiscoveryModelInput,
} from '../../src/discovery/index.js';
import type {
  CaptureScreenshotInput,
  EvidenceRecorder,
  FinishRunInput,
  RecordEventInput,
  RunEvidenceSummary,
} from '../../src/evidence/index.js';
import type { SessionManager } from '../../src/session/index.js';

const ENTRY_URL = 'https://bank.test/member-search';
const NOW = '2026-09-11T16:00:00.000Z';
const PNG_BYTES = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);

const readTarget = {
  description: 'Savings current balance',
  strategies: [
    {
      kind: 'role-name' as const,
      role: 'cell',
      name: {
        value: '$12,840.50',
        mode: 'exact' as const,
        caseSensitive: true,
      },
    },
  ],
  cardinality: 'exactly-one' as const,
};

const buttonTarget = {
  description: 'Accounts button',
  strategies: [
    {
      kind: 'role-name' as const,
      role: 'button',
      name: {
        value: 'Accounts',
        mode: 'exact' as const,
        caseSensitive: false,
      },
    },
  ],
  cardinality: 'exactly-one' as const,
};

function observation(url = ENTRY_URL): SurfaceObservation {
  return {
    sessionId: 'session-1',
    surfaceId: 'surface-1',
    observationId: 'observation-1',
    capturedAt: NOW,
    location: {
      kind: 'web',
      url,
      title: 'Member Search',
    },
    visibleText: 'Alex Morgan\nSavings\nCurrent Balance\n$12,840.50',
    controls: [],
    dialogs: [],
    loading: 'complete',
    truncated: {
      visibleText: false,
      controls: false,
    },
  };
}

class FakeSurface implements SurfaceAdapter<TargetStrategy> {
  readonly scope = {
    sessionId: 'session-1',
    surfaceId: 'surface-1',
  };

  currentUrl = ENTRY_URL;
  observationOverride: SurfaceObservation | null = null;
  resolution: 'resolved' | 'ambiguous' | 'not_found' = 'resolved';
  readonly resolutionOutcomes: Array<'resolved' | 'ambiguous' | 'not_found'> = [];
  readonly resolutionRequests: TargetResolutionRequest<TargetStrategy>[] = [];
  readonly performed: ActionExecutionRequest[] = [];
  readonly evidenceRequests: EvidenceCaptureRequest[] = [];
  actionFailure: SurfaceFailure | null = null;

  observe(options: ObservationOptions): Promise<ObservationResult> {
    void options;
    return Promise.resolve({
      status: 'success',
      observation: this.observationOverride ?? observation(this.currentUrl),
    });
  }

  resolveTarget(
    request: TargetResolutionRequest<TargetStrategy>,
    options: SurfaceOperationOptions,
  ): Promise<TargetResolutionResult> {
    void options;
    this.resolutionRequests.push(request);

    const resolution = this.resolutionOutcomes.shift() ?? this.resolution;

    if (resolution === 'ambiguous') {
      return Promise.resolve({ status: 'ambiguous', matchCount: 2 });
    }

    if (resolution === 'not_found') {
      return Promise.resolve({ status: 'not_found', matchCount: 0 });
    }

    return Promise.resolve({
      status: 'resolved',
      target: {
        ...this.scope,
        resolutionId: 'resolution-1',
        observationId: request.observationId,
        resolvedAt: NOW,
        description: request.description,
        matchedStrategyIndex: request.strategyIndex,
        cardinality: 'exactly-one',
      },
    });
  }

  perform(
    request: ActionExecutionRequest,
    options: SurfaceOperationOptions,
  ): Promise<ActionResult> {
    void options;
    this.performed.push(request);

    if (this.actionFailure !== null) {
      return Promise.resolve({
        ...this.scope,
        actionId: request.actionId,
        startedAt: NOW,
        finishedAt: NOW,
        durationMs: 0,
        evidenceRefs: [],
        status: 'failure',
        error: this.actionFailure,
      });
    }

    if (request.action.kind === 'navigate') {
      this.currentUrl = request.action.destination;
    }

    if (request.action.kind === 'dismiss' && this.observationOverride !== null) {
      this.observationOverride = {
        ...this.observationOverride,
        dialogs: [],
      };
    }

    const output =
      request.action.kind === 'read'
        ? {
            kind: 'read' as const,
            source: request.action.source,
            value: '$12,840.50',
          }
        : { kind: 'none' as const };

    return Promise.resolve({
      ...this.scope,
      actionId: request.actionId,
      startedAt: NOW,
      finishedAt: NOW,
      durationMs: 0,
      evidenceRefs: [],
      status: 'success',
      output,
    });
  }

  async evaluate(
    request: ConditionEvaluationRequest,
    options: ConditionWaitOptions & { readonly signal?: AbortSignal },
  ): Promise<ConditionResult> {
    const prepared = await request.prepare(options);

    if (
      prepared.status === 'ready' &&
      prepared.condition.kind === 'loadingComplete' &&
      this.observationOverride !== null
    ) {
      this.observationOverride = {
        ...this.observationOverride,
        loading: 'complete',
      };
    }
    return {
      ...this.scope,
      conditionId: 'condition-1',
      startedAt: NOW,
      finishedAt: NOW,
      durationMs: 0,
      attempts: 1,
      expected: true,
      observed: true,
      evidenceRefs: [],
      status: 'passed',
      passed: true,
    };
  }

  captureEvidence(
    request: EvidenceCaptureRequest,
    options: SurfaceOperationOptions,
  ): Promise<EvidenceCaptureResult> {
    void options;
    this.evidenceRequests.push(request);
    return Promise.resolve({
      status: 'success',
      evidence: {
        ...this.scope,
        kind: 'screenshot',
        mediaType: 'image/png',
        capturedAt: NOW,
        bytes: PNG_BYTES,
      },
    });
  }
}

class FakeModel implements DiscoveryDecisionModel {
  readonly inputs: DiscoveryModelInput[] = [];

  constructor(private readonly decisions: unknown[]) {}

  decide(input: DiscoveryModelInput): Promise<DiscoveryDecision> {
    this.inputs.push(input);

    const decision = this.decisions.shift();

    if (decision === undefined) {
      throw new Error('Fake model decision queue was exhausted');
    }

    return Promise.resolve(decision as DiscoveryDecision);
  }
}

class FakeCoordinator implements DiscoveryCoordinator {
  readonly events: RecordEventInput[] = [];
  readonly finishedStatuses: string[] = [];
  readonly screenshots: CaptureScreenshotInput[] = [];
  startOptions: StartCoordinatedRunOptions | null = null;

  constructor(
    private readonly surface: SurfaceAdapter<TargetStrategy>,
    private readonly policyEngine: PolicyEngine,
  ) {}

  start(options: StartCoordinatedRunOptions): Promise<CoordinatedRunContext<TargetStrategy>> {
    this.startOptions = options;
    const evidenceRecorder = {
      recordEvent: (event: RecordEventInput) => {
        this.events.push(event);
        return Promise.resolve();
      },
      captureScreenshot: (input: CaptureScreenshotInput) => {
        this.screenshots.push(input);
        return Promise.resolve({
          evidenceId: `screenshot-${this.screenshots.length}`,
          runId: options.runId,
          kind: 'screenshot' as const,
          relativePath: `${options.runId}/screenshots/screenshot-0001.png`,
          mediaType: 'image/png',
          capturedAt: input.capturedAt ?? NOW,
        });
      },
    } as unknown as EvidenceRecorder;

    return Promise.resolve({
      runId: 'run-1',
      mode: 'DISCOVERY',
      sessionManager: { sessionId: 'session-1' } as SessionManager,
      evidenceRecorder,
      policyEngine: this.policyEngine,
      surface: this.surface,
    });
  }

  finish(input: FinishRunInput): Promise<RunEvidenceSummary> {
    this.finishedStatuses.push(input.status);
    return Promise.resolve(this.summary(input.status));
  }

  fail(result: unknown): Promise<RunEvidenceSummary> {
    void result;
    this.finishedStatuses.push('failure');
    return Promise.resolve(this.summary('failure'));
  }

  private summary(status: RunEvidenceSummary['status']): RunEvidenceSummary {
    return {
      runId: 'run-1',
      mode: 'DISCOVERY',
      status,
      startedAt: NOW,
      finishedAt: NOW,
      durationMs: 0,
      evidenceRefs: [],
    };
  }
}

function policy(
  overrides: Partial<Record<PolicyActionKind, PolicyDecisionKind>> = {},
): PolicyEngine {
  const actions: PolicyActionKind[] = [
    'click',
    'type',
    'select',
    'check',
    'uncheck',
    'navigate',
    'read',
    'wait',
    'dismiss',
  ];

  return new PolicyEngine({
    policyId: 'discovery-test-policy',
    version: 1,
    defaultDecision: 'DENY',
    allowedOrigins: ['https://bank.test'],
    allowedRoutes: [
      {
        routeId: 'bank',
        description: 'Fake bank routes',
        match: { kind: 'prefix', pathname: '/' },
      },
    ],
    allowedActions: actions,
    riskRules: actions.map((action) => ({
      ruleId: `${action}-rule`,
      description: `${action} test rule`,
      match: { actions: [action], routeIds: ['bank'] },
      riskLevel: ['type', 'select', 'check', 'uncheck', 'dismiss'].includes(action)
        ? 'REVERSIBLE'
        : 'READ_ONLY',
      decision: overrides[action] ?? 'ALLOW',
    })),
  });
}

function request() {
  return {
    goal: "Read Alex Morgan's Savings balance",
    target: {
      entryUrl: ENTRY_URL,
      application: 'Demo Bank',
    },
    limits: {
      maxSteps: 10,
      timeoutMs: 30_000,
    },
  };
}

function engine(
  decisions: unknown[],
  options: {
    readonly surface?: FakeSurface;
    readonly policyEngine?: PolicyEngine;
    readonly maxRepeatedStates?: number;
  } = {},
) {
  const surface = options.surface ?? new FakeSurface();
  const model = new FakeModel(decisions);
  const coordinator = new FakeCoordinator(surface, options.policyEngine ?? policy());
  let id = 0;

  return {
    surface,
    model,
    coordinator,
    discovery: new DiscoveryEngine(
      { coordinator, model },
      {
        createId: () => `generated-${++id}`,
        now: () => new Date(NOW),
        ...(options.maxRepeatedStates === undefined
          ? {}
          : { maxRepeatedStates: options.maxRepeatedStates }),
      },
    ),
  };
}

describe('DiscoveryEngine', () => {
  it('completes only with output extracted by a successful surface read', async () => {
    const fixture = engine([
      {
        kind: 'read',
        target: readTarget,
        source: 'text',
        saveAs: 'savingsBalance',
        reason: 'Read the visible balance',
      },
      {
        kind: 'complete',
        summary: 'Read the Savings balance',
        outputs: { savingsBalance: '$12,840.50' },
      },
    ]);

    await expect(fixture.discovery.run(request())).resolves.toMatchObject({
      status: 'success',
      steps: 2,
      outputs: { savingsBalance: '$12,840.50' },
    });

    expect(fixture.surface.performed.map((entry) => entry.action.kind)).toEqual(['read']);
    expect(fixture.coordinator.finishedStatuses).toEqual(['success']);
    const traceKinds = fixture.coordinator.events
      .filter((event) => event.eventType === 'discovery_trace')
      .map((event) =>
        typeof event.result === 'object' && event.result !== null && 'kind' in event.result
          ? event.result.kind
          : null,
      );
    expect(traceKinds).toEqual(
      expect.arrayContaining([
        'observation',
        'model_decision',
        'policy_decision',
        'target_resolution',
        'action_result',
        'runtime_event',
      ]),
    );

    expect(fixture.coordinator.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        'discovery.started',
        'observation.captured',
        'model.decision.requested',
        'model.decision.received',
        'policy.evaluated',
        'target.resolved',
        'action.started',
        'action.completed',
        'value.extracted',
        'discovery.completed',
      ]),
    );
  });

  it('captures useful screenshots only for an explicitly synthetic discovery run', async () => {
    const fixture = engine([
      {
        kind: 'read',
        target: readTarget,
        source: 'text',
        saveAs: 'savingsBalance',
        reason: 'Read the visible balance',
      },
      {
        kind: 'complete',
        summary: 'Read the Savings balance',
        outputs: { savingsBalance: '$12,840.50' },
      },
    ]);

    await expect(
      fixture.discovery.run(request(), {
        runId: 'discovery-lookup-savings-balance',
        evidenceRoot: 'evidence',
        screenshotEvidence: 'synthetic_fixture',
        headed: true,
      }),
    ).resolves.toMatchObject({ status: 'success' });

    expect(fixture.coordinator.startOptions).toMatchObject({
      runId: 'discovery-lookup-savings-balance',
      evidenceRoot: 'evidence',
      headed: true,
    });
    expect(fixture.surface.evidenceRequests).toEqual([
      { kind: 'screenshot', extent: 'viewport' },
      { kind: 'screenshot', extent: 'viewport' },
    ]);
    expect(fixture.coordinator.screenshots).toHaveLength(2);
    expect(fixture.coordinator.screenshots[0]?.dataHandling).toBe('SYNTHETIC_FIXTURE_ONLY');
    const screenshotEvents = fixture.coordinator.events.filter(
      (event) => event.eventType === 'evidence_captured',
    );

    expect(screenshotEvents).toMatchObject([
      {
        result: {
          kind: 'screenshot',
          status: 'success',
          purpose: 'initial_state',
          dataHandling: 'SYNTHETIC_FIXTURE_ONLY',
        },
        evidenceRefs: [
          {
            kind: 'screenshot',
          },
        ],
      },
      {
        result: {
          kind: 'screenshot',
          status: 'success',
          purpose: 'step_observation',
          dataHandling: 'SYNTHETIC_FIXTURE_ONLY',
        },
        evidenceRefs: [
          {
            kind: 'screenshot',
          },
        ],
      },
    ]);

    const observationEvents = fixture.coordinator.events.filter(
      (event) => event.eventType === 'observation',
    );
    expect(observationEvents).toHaveLength(2);
    expect(observationEvents[0]?.evidenceRefs).toMatchObject([{ kind: 'screenshot' }]);
  });

  it('rejects unsupported completion and then escalates repeated state', async () => {
    const fixture = engine(
      [
        {
          kind: 'complete',
          summary: 'Claimed completion without reading',
          outputs: { savingsBalance: '$12,840.50' },
        },
      ],
      { maxRepeatedStates: 2 },
    );

    await expect(fixture.discovery.run(request())).resolves.toMatchObject({
      status: 'intervention_required',
      intervention: {
        code: 'AUTOMATION_STUCK',
        context: { source: 'repeated_state' },
      },
    });

    expect(fixture.model.inputs).toHaveLength(1);
    expect(
      fixture.coordinator.events.some(
        (event) =>
          event.eventType === 'model_decision' &&
          typeof event.result === 'object' &&
          event.result !== null &&
          'accepted' in event.result &&
          event.result.accepted === false,
      ),
    ).toBe(true);
  });

  it('rejects a read-backed Savings completion without compatible final context', async () => {
    const surface = new FakeSurface();
    surface.observationOverride = {
      ...observation(),
      location: {
        kind: 'web',
        url: 'https://bank.test/member/alex/accounts',
        title: 'Alex Morgan Accounts',
      },
      visibleText: 'Available amount\n$12,840.50',
    };
    const fixture = engine(
      [
        {
          kind: 'read',
          target: readTarget,
          source: 'text',
          saveAs: 'savingsBalance',
          reason: 'Read the visible amount',
        },
        {
          kind: 'complete',
          summary: 'Claimed a Savings balance outside Savings context',
          outputs: { savingsBalance: '$12,840.50' },
        },
      ],
      { surface, maxRepeatedStates: 2 },
    );

    await expect(fixture.discovery.run(request())).resolves.toMatchObject({
      status: 'intervention_required',
      intervention: {
        code: 'AUTOMATION_STUCK',
        context: { source: 'repeated_state' },
      },
    });

    expect(
      fixture.coordinator.events.some(
        (event) =>
          event.eventType === 'model_decision' &&
          JSON.stringify(event.result).includes('FINAL_OBSERVATION_CONTEXT_MISMATCH'),
      ),
    ).toBe(true);
  });

  it('honors a first-class model escalation decision', async () => {
    const fixture = engine([
      {
        kind: 'escalate',
        reasonCode: 'AUTOMATION_STUCK',
        reason: 'Unable to identify a safe next action',
      },
    ]);

    await expect(fixture.discovery.run(request())).resolves.toMatchObject({
      status: 'intervention_required',
      intervention: {
        code: 'AUTOMATION_STUCK',
        message: 'Unable to identify a safe next action',
        context: { source: 'model' },
      },
    });
  });

  it('lets PolicyEngine force intervention without executing the model action', async () => {
    const fixture = engine(
      [
        {
          kind: 'click',
          target: buttonTarget,
          reason: 'Open accounts',
        },
      ],
      { policyEngine: policy({ click: 'REQUIRE_HUMAN' }) },
    );

    await expect(fixture.discovery.run(request())).resolves.toMatchObject({
      status: 'intervention_required',
      intervention: {
        code: 'HUMAN_APPROVAL_REQUIRED',
        context: { source: 'policy', actionKind: 'click' },
      },
    });

    expect(fixture.surface.performed).toHaveLength(0);
  });

  it('forces safe escalation when target resolution is ambiguous', async () => {
    const surface = new FakeSurface();
    surface.resolution = 'ambiguous';
    const fixture = engine(
      [
        {
          kind: 'click',
          target: buttonTarget,
          reason: 'Open accounts',
        },
      ],
      { surface },
    );

    await expect(fixture.discovery.run(request())).resolves.toMatchObject({
      status: 'intervention_required',
      intervention: {
        code: 'AUTOMATION_STUCK',
        context: {
          source: 'unsafe_ambiguity',
          targetDescription: 'Accounts button',
        },
      },
    });

    expect(surface.performed).toHaveLength(0);
  });

  it('navigates through SurfaceAdapter when the session is not at the entry URL', async () => {
    const surface = new FakeSurface();
    surface.currentUrl = 'https://bank.test/';
    const fixture = engine(
      [
        {
          kind: 'escalate',
          reasonCode: 'AUTOMATION_STUCK',
          reason: 'Stop after verifying entry navigation',
        },
      ],
      { surface },
    );

    await fixture.discovery.run(request());

    expect(surface.performed[0]?.action).toEqual({
      kind: 'navigate',
      destination: ENTRY_URL,
    });
    expect(surface.currentUrl).toBe(ENTRY_URL);
  });

  it('falls back across zero, multiple, then exactly-one matches before execution', async () => {
    const surface = new FakeSurface();
    surface.resolutionOutcomes.push('not_found', 'ambiguous', 'resolved');

    const fallbackTarget = {
      description: 'View member details',
      strategies: [
        {
          kind: 'role-name' as const,
          role: 'button',
          name: { value: 'View details', mode: 'exact' as const, caseSensitive: false },
        },
        {
          kind: 'label' as const,
          label: { value: 'View details', mode: 'exact' as const, caseSensitive: false },
        },
        {
          kind: 'text' as const,
          text: { value: 'View details', mode: 'exact' as const, caseSensitive: false },
        },
      ],
      cardinality: 'exactly-one' as const,
    };

    const fixture = engine(
      [
        {
          kind: 'click',
          target: fallbackTarget,
          reason: 'Open the uniquely resolved member details',
        },
        {
          kind: 'escalate',
          reasonCode: 'AUTOMATION_STUCK',
          reason: 'Stop after verifying target resolution',
        },
      ],
      { surface },
    );

    await fixture.discovery.run(request());

    expect(surface.resolutionRequests.map((entry) => entry.strategyIndex)).toEqual([0, 1, 2]);
    expect(surface.performed).toHaveLength(1);
    expect(surface.performed[0]?.action).toMatchObject({
      kind: 'click',
      target: {
        cardinality: 'exactly-one',
        matchedStrategyIndex: 2,
      },
    });
  });

  it('tries every strategy and escalates safely when all matches are ambiguous', async () => {
    const surface = new FakeSurface();
    surface.resolution = 'ambiguous';

    const fixture = engine(
      [
        {
          kind: 'click',
          target: {
            description: 'View member details',
            strategies: [
              {
                kind: 'role-name',
                role: 'button',
                name: { value: 'View', mode: 'exact', caseSensitive: false },
              },
              {
                kind: 'text',
                text: { value: 'View', mode: 'exact', caseSensitive: false },
              },
            ],
            cardinality: 'exactly-one',
          },
          reason: 'Open member details',
        },
      ],
      { surface },
    );

    await expect(fixture.discovery.run(request())).resolves.toMatchObject({
      status: 'intervention_required',
      intervention: {
        code: 'AUTOMATION_STUCK',
        context: {
          source: 'unsafe_ambiguity',
          resolutionAttempts: 2,
        },
      },
    });

    expect(surface.resolutionRequests.map((entry) => entry.strategyIndex)).toEqual([0, 1]);
    expect(surface.performed).toHaveLength(0);
  });

  it('does not execute when every targeting strategy returns zero matches', async () => {
    const surface = new FakeSurface();
    surface.resolution = 'not_found';

    const fixture = engine(
      [
        {
          kind: 'click',
          target: {
            description: 'View member details',
            strategies: [
              {
                kind: 'role-name',
                role: 'button',
                name: { value: 'View', mode: 'exact', caseSensitive: false },
              },
              {
                kind: 'text',
                text: { value: 'View', mode: 'exact', caseSensitive: false },
              },
            ],
            cardinality: 'exactly-one',
          },
          reason: 'Open member details',
        },
        {
          kind: 'escalate',
          reasonCode: 'AUTOMATION_STUCK',
          reason: 'No unique target was available',
        },
      ],
      { surface },
    );

    await fixture.discovery.run(request());

    expect(surface.resolutionRequests.map((entry) => entry.strategyIndex)).toEqual([0, 1]);
    expect(surface.performed).toHaveLength(0);
    expect(fixture.model.inputs[1]?.observation.recentError).toMatchObject({
      code: 'TARGET_NOT_FOUND',
      recoverable: true,
    });
  });

  it('terminates immediately when surface execution returns a hard action failure', async () => {
    const surface = new FakeSurface();
    surface.actionFailure = {
      code: 'ACTION_FAILED',
      message: 'The application rejected the action',
      expected: 'successful click',
      observed: 'application failure',
    };

    const fixture = engine(
      [
        {
          kind: 'click',
          target: buttonTarget,
          reason: 'Open accounts',
        },
      ],
      { surface },
    );

    await expect(fixture.discovery.run(request())).resolves.toMatchObject({
      status: 'failure',
      error: {
        code: 'ACTION_FAILED',
        message: 'The application rejected the action',
      },
    });

    expect(surface.performed).toHaveLength(1);
    expect(fixture.model.inputs).toHaveLength(1);
    expect(fixture.coordinator.finishedStatuses).toEqual(['failure']);
  });

  it('retries one invalid model decision and then returns a typed validation failure', async () => {
    const fixture = engine([
      { kind: 'click', reason: 'Missing target' },
      { kind: 'unsupported-action' },
    ]);

    await expect(fixture.discovery.run(request())).resolves.toMatchObject({
      status: 'failure',
      error: {
        code: 'MODEL_DECISION_VALIDATION_FAILED',
        expected: 'one valid DiscoveryDecision',
        observed: { attempts: 2 },
      },
    });

    expect(fixture.model.inputs).toHaveLength(2);
    expect(fixture.surface.performed).toHaveLength(0);
    expect(fixture.coordinator.finishedStatuses).toEqual(['failure']);
    expect(
      fixture.coordinator.events.filter((event) => event.eventType === 'model.decision.invalid'),
    ).toHaveLength(2);
    expect(fixture.coordinator.events.map((event) => event.eventType)).toContain(
      'discovery.failed',
    );
  });

  it('waits for a slow application state before asking the model', async () => {
    const surface = new FakeSurface();
    surface.observationOverride = {
      ...observation(),
      location: {
        kind: 'web',
        url: ENTRY_URL,
        title: 'Loading | Demo Credit Union',
      },
      visibleText: 'Loading banking information...',
      loading: 'loading',
    };
    const fixture = engine(
      [
        {
          kind: 'escalate',
          reasonCode: 'AUTOMATION_STUCK',
          reason: 'Stop after the loading check',
        },
      ],
      { surface },
    );

    await fixture.discovery.run(request());

    expect(fixture.model.inputs).toHaveLength(1);
    expect(fixture.coordinator.events.some((event) => event.eventType === 'condition')).toBe(true);
    expect(surface.performed).toHaveLength(0);
  });

  it('returns a permission-denied business outcome without consulting the model', async () => {
    const surface = new FakeSurface();
    surface.observationOverride = {
      ...observation(),
      location: {
        kind: 'web',
        url: 'https://bank.test/member/alex',
        title: 'PERMISSION_DENIED | Demo Credit Union',
      },
      visibleText: 'Access to this member is restricted.',
    };
    const fixture = engine([], { surface });

    await expect(fixture.discovery.run(request())).resolves.toMatchObject({
      status: 'business_outcome',
      outcome: { code: 'PERMISSION_DENIED' },
    });
    expect(fixture.model.inputs).toHaveLength(0);
    expect(surface.performed.map((entry) => entry.action.kind)).toEqual(['navigate']);
  });

  it.each([
    ['SESSION_EXPIRED', 'SESSION_EXPIRED_UNRECOVERABLE'],
    ['APPLICATION_ERROR', 'APPLICATION_ERROR'],
  ] as const)('stops %s without blind model actions', async (title, failureCode) => {
    const surface = new FakeSurface();
    surface.observationOverride = {
      ...observation(),
      location: {
        kind: 'web',
        url: ENTRY_URL,
        title: `${title} | Demo Credit Union`,
      },
      visibleText: title,
    };
    const fixture = engine([], { surface });

    await expect(fixture.discovery.run(request())).resolves.toMatchObject({
      status: 'failure',
      error: { code: failureCode },
    });
    expect(fixture.model.inputs).toHaveLength(0);
    expect(surface.performed).toHaveLength(0);
  });

  it('allows a known safe interstitial to follow normal model and policy handling', async () => {
    const surface = new FakeSurface();
    surface.observationOverride = {
      ...observation(),
      controls: [
        {
          controlId: 'continue-link',
          name: 'Continue',
          role: 'link',
          visible: true,
          enabled: true,
          bounds: { x: 0, y: 0, width: 100, height: 30 },
          kind: 'link',
          destination: `${ENTRY_URL}?continue=1`,
        },
      ],
      dialogs: [
        {
          kind: 'surface',
          dialogId: 'service-notice',
          presentation: 'interstitial',
          title: 'Scheduled Service Notice',
          text: 'This is a known demonstration notice.',
          controlIds: ['continue-link'],
        },
      ],
    };
    const fixture = engine(
      [
        {
          kind: 'dismiss',
          dialog: {
            kind: 'surface',
            target: {
              description: 'Continue from service notice',
              strategies: [
                {
                  kind: 'role-name',
                  role: 'link',
                  name: { value: 'Continue', mode: 'exact', caseSensitive: false },
                },
              ],
              cardinality: 'exactly-one',
            },
          },
          reason: 'Dismiss the known safe service notice',
        },
        {
          kind: 'escalate',
          reasonCode: 'AUTOMATION_STUCK',
          reason: 'Stop after dismissing the known notice',
        },
      ],
      { surface },
    );

    await fixture.discovery.run(request());

    expect(surface.performed.map((entry) => entry.action.kind)).toEqual(['dismiss']);
    expect(fixture.model.inputs).toHaveLength(2);
  });

  it('escalates an unknown dialog before asking the model to act', async () => {
    const surface = new FakeSurface();
    surface.observationOverride = {
      ...observation(),
      dialogs: [
        {
          kind: 'native',
          dialogId: 'unknown-confirmation',
          type: 'confirm',
          message: 'Approve this unknown operation?',
          defaultValue: null,
        },
      ],
    };
    const fixture = engine([], { surface });

    await expect(fixture.discovery.run(request())).resolves.toMatchObject({
      status: 'intervention_required',
      intervention: {
        code: 'AUTOMATION_STUCK',
        context: { source: 'unsafe_dialog' },
      },
    });
    expect(fixture.model.inputs).toHaveLength(0);
    expect(surface.performed).toHaveLength(0);
  });
});
