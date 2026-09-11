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
  EvidenceRecorder,
  FinishRunInput,
  RecordEventInput,
  RunEvidenceSummary,
} from '../../src/evidence/index.js';
import type { SessionManager } from '../../src/session/index.js';

const ENTRY_URL = 'https://bank.test/member-search';
const NOW = '2026-09-11T16:00:00.000Z';

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
  resolution: 'resolved' | 'ambiguous' | 'not_found' = 'resolved';
  readonly performed: ActionExecutionRequest[] = [];

  observe(options: ObservationOptions): Promise<ObservationResult> {
    void options;
    return Promise.resolve({
      status: 'success',
      observation: observation(this.currentUrl),
    });
  }

  resolveTarget(
    request: TargetResolutionRequest<TargetStrategy>,
    options: SurfaceOperationOptions,
  ): Promise<TargetResolutionResult> {
    void options;
    if (this.resolution === 'ambiguous') {
      return Promise.resolve({ status: 'ambiguous', matchCount: 2 });
    }

    if (this.resolution === 'not_found') {
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

    if (request.action.kind === 'navigate') {
      this.currentUrl = request.action.destination;
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

  evaluate(
    request: ConditionEvaluationRequest,
    options: ConditionWaitOptions & { readonly signal?: AbortSignal },
  ): Promise<ConditionResult> {
    void request;
    void options;
    return Promise.resolve({
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
    });
  }

  captureEvidence(
    request: EvidenceCaptureRequest,
    options: SurfaceOperationOptions,
  ): Promise<EvidenceCaptureResult> {
    void request;
    void options;
    return Promise.resolve({
      status: 'failure',
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: 'Not required by this unit test',
        expected: null,
        observed: null,
      },
    });
  }
}

class FakeModel implements DiscoveryDecisionModel {
  readonly inputs: DiscoveryModelInput[] = [];

  constructor(private readonly decisions: DiscoveryDecision[]) {}

  decide(input: DiscoveryModelInput): Promise<DiscoveryDecision> {
    this.inputs.push(input);

    const decision = this.decisions.shift();

    if (decision === undefined) {
      throw new Error('Fake model decision queue was exhausted');
    }

    return Promise.resolve(decision);
  }
}

class FakeCoordinator implements DiscoveryCoordinator {
  readonly events: RecordEventInput[] = [];
  readonly finishedStatuses: string[] = [];

  constructor(
    private readonly surface: SurfaceAdapter<TargetStrategy>,
    private readonly policyEngine: PolicyEngine,
  ) {}

  start(options: StartCoordinatedRunOptions): Promise<CoordinatedRunContext<TargetStrategy>> {
    void options;
    const evidenceRecorder = {
      recordEvent: (event: RecordEventInput) => {
        this.events.push(event);
        return Promise.resolve();
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
      riskLevel: 'READ_ONLY',
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
  decisions: DiscoveryDecision[],
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
      outputs: { savingsBalance: '$12,840.50' },
    });

    expect(fixture.surface.performed.map((entry) => entry.action.kind)).toEqual(['read']);
    expect(fixture.coordinator.finishedStatuses).toEqual(['success']);
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
});
