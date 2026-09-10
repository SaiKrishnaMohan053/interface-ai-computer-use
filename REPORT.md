# 1. Architecture

The system is a TypeScript modular monolith using Node.js, Playwright, Zod, and Vitest. A
single process is sufficient for this assignment and keeps browser ownership, evidence order,
and failure cleanup explicit. Queues and distributed services would add operational complexity
without improving the core computer-use design.

`SurfaceAdapter<TStrategy>` separates orchestration from the concrete UI technology. It
defines observation, target resolution, action execution, condition evaluation, and in-memory
evidence capture without exposing Playwright objects. `PlaywrightSurface` is the first
implementation; a future desktop adapter can implement the same responsibilities.

`SessionManager` owns the Browser, BrowserContext, Page, state, and exclusive actor owner.
`RunCoordinator` wires the outer run lifecycle: start evidence, create and activate the
session, acquire discovery or replay ownership, create the surface, and close or fail resources.
It deliberately contains no discovery or replay loop.

The current handwritten integration path uses a real Chromium browser against a deterministic,
fictional banking application. It covers member search, account navigation, semantic balance
lookup, dialogs, slow loading, permission denial, session expiry, and application failure.

# 2. Artifact schema

The final capability artifact will be typed, versioned, parameterized, and independent of the
raw LLM transcript. Discovery history, diagnostic evidence, and the reusable capability are
separate records.

Phase 1 establishes the lower-level contracts the artifact will reference: surface actions,
conditions, target specifications, runtime outcomes, and evidence references. A target contains
a description, ordered strategies, and `exactly-one` cardinality. Inputs such as member names
will become parameters rather than recorded tenant or user values.

`ResolvedTarget` is intentionally not artifact data. It is a short-lived handle scoped to one
session, surface, and observation. Persisting it would create a brittle replay capability.

Capability schema validation, compilation, approval state, storage, and loading are deferred
until the artifact phase.

# 3. Determinism & error handling

The Target Resolver evaluates strategies in order:

```text
0 matches  â†’ try the next strategy
1 match    â†’ success
>1 matches â†’ record ambiguity and try the next strategy
```

After exhaustion it returns `TARGET_NOT_FOUND` or `TARGET_AMBIGUOUS`; it never silently
chooses the first result. Strategies prefer role/name, label, text, and structural relationships,
with CSS and XPath as explicit fallbacks. No test-ID convention is assumed.

The accounts-table primitive resolves a cell semantically: find the Accounts table, locate the
row where Account Type is Savings, and read Current Balance. It derives row and column positions
from headers and values instead of storing row 3 or column 4.

Synchronization uses bounded polling and explicit timeouts for `elementVisible`,
`elementAbsent`, `textPresent`, `urlMatches`, `valueEquals`, and
`loadingComplete`. Every attempt prepares fresh target information. Ambiguity is an error,
not evidence that an element is absent.

Terminal results distinguish `success`, `business_outcome`, `intervention_required`, and
`failure`. Expected business outcomes such as `MEMBER_NOT_FOUND` and
`PERMISSION_DENIED` are separate from recoverable conditions and hard execution failures.
The full replay classifier and bounded recovery behavior are deferred.

# 4. Heterogeneity & multi-tenant

The orchestration boundary depends on `SurfaceAdapter`, not Playwright. A desktop,
accessibility-tree, screenshot-coordinate, or OS-level adapter can provide the same observation
and execution contract while keeping platform handles private.

The current Playwright collector intentionally covers the main document, standard HTML controls,
and explicit ARIA dialogs. Frames, general shadow DOM, custom widgets, full accessibility-tree
collection, and pixel targeting are future adapter improvements.

For institutions running variants of the same application, capability artifacts should
parameterize origins, route values, and user inputs while preserving semantic targets and
checkpoints. Tenant policy and browser sessions must remain isolated. Cross-tenant
canonicalization and per-variant overrides are designed as later artifact features; production
multi-tenant infrastructure is not part of this submission phase.

# 5. Escalation & handoff

Session ownership is exclusive: `NONE`, `DISCOVERY`, `REPLAY`, or `HUMAN`.
Automation operates only in an active session. Human ownership is allowed only while paused,
and automation cannot resume until human ownership is transferred or released.

Pause and resume preserve the same BrowserContext and Page, so a future operator will take over
the live session rather than a new browser. Conflicting ownership changes are rejected.

The remaining handoff layer must detect a stuck or approval-required state, create an
intervention request with current step and sanitized evidence, pause the session, transfer
ownership to the operator, record human actions, and transfer ownership back before resuming.
Phase 1 implements and tests the ownership seam but not the operator interface or stuck-state
classifier.

# 6. Safety

The Policy Engine validates the current URL origin, route, requested action, and matching risk
rule. It is deterministic and defaults to denial. Risk comes from trusted configuration rather
than an LLM or artifact claim.

Risk levels are `READ_ONLY`, `REVERSIBLE`, `SENSITIVE_WRITE`, and `IRREVERSIBLE`.
Decisions are `ALLOW`, `DENY`, and `REQUIRE_HUMAN`. Sensitive or irreversible actions
cannot be configured for automatic allowance.

Target cardinality is exactly one. Foreign, stale, detached, or ambiguous targets are rejected.
A cancelled or timed-out mutating Playwright operation invalidates the surface to prevent delayed
execution. Dialogs are observed but never automatically accepted.

Before persistence, recursive sanitization redacts member identifiers, passwords, API keys,
tokens, cookies, authorization headers, and nested sensitive strings. JSONL evidence is
sanitized before serialization, not written raw and scrubbed afterward.

JSON redaction cannot remove text from pixels. Screenshot evidence must therefore be synthetic
or masked before capture. Playwright traces can contain raw browser metadata, so trace attachment
is currently restricted to synthetic fixtures. Live-data trace export is unsupported rather
than falsely presented as sanitized.

# 7. Cuts

Phase 1 implements the banking fixture, surface contracts, Playwright adapter, session ownership,
target resolution, structural targeting, condition evaluation, runtime outcomes, policy,
redaction, evidence recording, coordinator lifecycle, and development CLI.

The following remain intentionally deferred:

- LLM-driven observe-decide-act discovery.
- Capability artifact schema and discovery-to-artifact compilation.
- Artifact approval, storage, loading, and parameter binding.
- Deterministic replay and its full error classifier.
- Bounded policy-checked recovery.
- Intervention request and stuck-state classification.
- Human operator UI and live control transport.
- Final discovery/replay CLI commands and submission evidence.

Redis, Kafka, queues, microservices, Kubernetes, browser farms, and production multi-tenant
infrastructure are excluded. The priority is a small, testable core with clear seams for the
assignment's load-bearing capabilities.
