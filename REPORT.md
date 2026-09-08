# 1. Architecture

The foundation uses one TypeScript repository with Node.js, Playwright, Zod,
and Vitest. Browser-specific behavior will sit behind a surface-neutral adapter.

Session Manager will own browser resources and enforce exclusive actor ownership.
Automated actions will pass through schema validation, policy, target resolution,
and the surface adapter.

Phase 1.1 establishes tooling and module boundaries only.

# 2. Artifact schema

The capability contract will be typed, versioned, parameterized, and surface-neutral.
Discovery traces and reusable capability artifacts are separate concepts.

Artifact compilation and storage are not implemented in Phase 1.1.

# 3. Determinism & error handling

Phase 1 will establish ordered target resolution, explicit conditions,
and typed runtime outcomes.

A handwritten integration flow will verify these foundations without an LLM.
The final replay engine belongs to a later phase.

# 4. Heterogeneity & multi-tenant

Surface contracts will isolate browser-specific perception and actions.

Desktop adapters and multi-tenant reuse will be addressed in the design.
Desktop support and multi-tenant infrastructure are not implementation scope.

# 5. Escalation & handoff

Session Manager will enforce exclusive ownership:
NONE, DISCOVERY, REPLAY, or HUMAN.

Human ownership must block automation. Pause and resume must preserve the same
live BrowserContext. The operator interface belongs to a later phase.

# 6. Safety

Phase 1 will enforce configurable origin, route, action, and risk policies.

Sensitive values must be sanitized before persistence. This applies to logs,
screenshots, and traces; JSONL redaction alone is insufficient.

Generated outputs are ignored by Git by default. Reviewed, sanitized evidence
will be explicitly included in the final submission.

# 7. Cuts

Phase 1.1 implements repository tooling and documentation only.

The banking UI, runtime, LLM discovery, capability compilation, final replay
engine, and operator interface are not implemented in this step.

Redis, Kafka, queues, microservices, Kubernetes, and browser farms are excluded.
