import { parsePolicyConfig, parsePolicyDecision, riskLevelSchema } from './policy-schema.js';

import type {
  AllowedRoute,
  PolicyActionKind,
  PolicyConfig,
  PolicyDecision,
  RiskLevel,
  RiskRule,
} from './policy-schema.js';

export interface PolicyEvaluationRequest {
  readonly url: unknown;

  readonly action: {
    readonly kind: unknown;
  };

  /** Trusted system-derived minimum. Never populate this from a model claim. */
  readonly systemRiskLevel?: unknown;
}

interface AllowedLocation {
  readonly url: URL;
  readonly routeIds: ReadonlySet<string>;
}

/**
 * Deterministic, fail-closed policy evaluation.
 *
 * Risk is derived only from trusted configuration,
 * never from an agent-provided claim.
 */
export class PolicyEngine {
  private readonly config: PolicyConfig;
  private readonly origins: ReadonlySet<string>;
  private readonly actions: ReadonlySet<string>;

  constructor(config: unknown) {
    this.config = parsePolicyConfig(config);

    this.origins = new Set(this.config.allowedOrigins);

    this.actions = new Set(this.config.allowedActions);
  }

  get policyId(): string {
    return this.config.policyId;
  }

  evaluate(request: PolicyEvaluationRequest): PolicyDecision {
    const location = this.validateLocation(request.url);

    if ('decision' in location) {
      return location;
    }

    const action = this.validateAction(request.action.kind);

    if (typeof action !== 'string') {
      return action;
    }

    const systemRisk = this.validateSystemRisk(request.systemRiskLevel);

    if (typeof systemRisk !== 'string' && systemRisk !== null) {
      return systemRisk;
    }

    return this.evaluateRisk(action, location, systemRisk);
  }

  private validateLocation(value: unknown): AllowedLocation | PolicyDecision {
    if (typeof value !== 'string') {
      return this.deny('Request URL is invalid');
    }

    let url: URL;

    try {
      url = new URL(value);
    } catch {
      return this.deny('Request URL is invalid');
    }

    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username.length > 0 ||
      url.password.length > 0
    ) {
      return this.deny('Request URL is not an allowed HTTP(S) location');
    }

    if (!this.origins.has(url.origin)) {
      return this.deny('Request origin is not allowed');
    }

    const routeIds = new Set(
      this.config.allowedRoutes
        .filter((route) => this.routeMatches(route, url.pathname))
        .map((route) => route.routeId),
    );

    if (routeIds.size === 0) {
      return this.deny('Request route is not allowed');
    }

    return {
      url,
      routeIds,
    };
  }

  private routeMatches(route: AllowedRoute, pathname: string): boolean {
    return route.match.kind === 'exact'
      ? pathname === route.match.pathname
      : pathname.startsWith(route.match.pathname);
  }

  private validateAction(value: unknown): PolicyActionKind | PolicyDecision {
    if (typeof value !== 'string' || !this.actions.has(value)) {
      return this.deny('Request action is not allowed');
    }

    return value as PolicyActionKind;
  }

  private validateSystemRisk(value: unknown): RiskLevel | null | PolicyDecision {
    if (value === undefined) {
      return null;
    }

    const parsed = riskLevelSchema.safeParse(value);

    return parsed.success ? parsed.data : this.deny('System risk classification is invalid');
  }

  private evaluateRisk(
    action: PolicyActionKind,
    location: AllowedLocation,
    systemRisk: RiskLevel | null,
  ): PolicyDecision {
    /*
     * Risk rule order is significant.
     * First matching rule wins.
     */
    const rule = this.config.riskRules.find(
      (candidate) =>
        candidate.match.actions.includes(action) &&
        (candidate.match.routeIds === undefined ||
          candidate.match.routeIds.some((routeId) => location.routeIds.has(routeId))),
    );

    if (!rule) {
      return this.deny('No risk rule allowed this action');
    }

    if (systemRisk !== null && this.riskRank(rule.riskLevel) < this.riskRank(systemRisk)) {
      return this.deny(
        `Policy rule under-classifies system-derived ${systemRisk} risk`,
        systemRisk,
        rule.ruleId,
      );
    }

    return this.decisionFromRule(rule);
  }

  private riskRank(riskLevel: RiskLevel): number {
    switch (riskLevel) {
      case 'READ_ONLY':
        return 0;
      case 'REVERSIBLE':
        return 1;
      case 'SENSITIVE_WRITE':
        return 2;
      case 'IRREVERSIBLE':
        return 3;
    }
  }

  private decisionFromRule(rule: RiskRule): PolicyDecision {
    const base = {
      policyId: this.config.policyId,
      riskLevel: rule.riskLevel,
      matchedRuleId: rule.ruleId,
      reason: rule.description,
    };

    switch (rule.decision) {
      case 'ALLOW':
        return parsePolicyDecision({
          ...base,
          decision: 'ALLOW',
        });

      case 'DENY':
        return parsePolicyDecision({
          ...base,
          decision: 'DENY',
          code: 'POLICY_DENIED',
        });

      case 'REQUIRE_HUMAN':
        return parsePolicyDecision({
          ...base,
          decision: 'REQUIRE_HUMAN',
          code: 'HUMAN_APPROVAL_REQUIRED',
        });
    }
  }

  private deny(
    reason: string,
    riskLevel: RiskLevel | null = null,
    matchedRuleId: string | null = null,
  ): PolicyDecision {
    return parsePolicyDecision({
      policyId: this.config.policyId,
      decision: 'DENY',
      code: 'POLICY_DENIED',
      riskLevel,
      matchedRuleId,
      reason,
    });
  }
}
