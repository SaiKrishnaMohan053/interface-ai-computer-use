# 1. Architecture

The system is implemented as a TypeScript modular monolith using Node.js, Playwright, Zod, and Vitest. A single process keeps browser ownership, evidence ordering, policy evaluation, and failure cleanup explicit. Distributed queues or services would add operational complexity without improving the assignment's core computer-use workflow.

The main runtime boundaries are:

- `DiscoveryEngine` owns the bounded observe, decide, validate, authorize, resolve, and act loop.
- `DiscoveryDecisionModel` is the only interface through which the LLM participates.
- `SurfaceAdapter` separates orchestration from the concrete UI technology.
- `PlaywrightSurface` implements browser observation and execution.
- `PolicyEngine` makes deterministic authorization decisions.
- `TargetResolver` applies ordered semantic target strategies.
- `SessionManager` owns the live browser session and exclusive actor ownership.
- `EvidenceRecorder` persists sanitized run events and screenshots.
- `RunCoordinator` manages run start, finish, and resource cleanup.

The LLM receives a goal, a sanitized surface-neutral observation, bounded recent history, and the result of the previous step. It returns one typed decision such as `type`, `click`, `read`, `wait`, `dismiss`, `complete`, or `escalate`.

The model does not receive Playwright objects and cannot directly execute browser operations. Every actionable decision follows this runtime-controlled path:

```text
LLM decision
-> schema validation
-> system risk classification
-> policy evaluation
-> semantic target resolution
-> SurfaceAdapter execution
```

This boundary keeps probabilistic reasoning separate from trusted execution. The LLM proposes what should happen next, while deterministic runtime components decide whether and how it may happen.

Playwright was selected because it provides a practical real browser surface for the assignment. Browser-specific handles remain private to the adapter so the discovery engine is not tied directly to DOM automation.

# 2. Artifact schema

The reusable capability artifact and artifact compiler are not implemented yet.

Phase 2 keeps discovery data in an explicit run-scoped state. This includes:

- Current step and run start time.
- Observation fingerprints and repeated-state count.
- Recently executed decisions and their outcomes.
- Extracted values such as the Savings balance.
- Structured discovery step records.
- Sanitized evidence references.

Extracted values are discovery working outputs only. They are not automatically treated as approved reusable capability outputs.

The discovery trace is also separate from the future artifact. It records what occurred during the run, including observations, model decisions, concise decision reasons, policy results, target-resolution attempts, action results, extracted values, runtime events, and screenshots. It does not persist raw model responses or hidden chain-of-thought.

A later artifact compiler will use successful discovery evidence to produce a typed and versioned capability containing:

- Ordered steps and actions.
- Typed invocation parameters.
- Typed extracted outputs.
- Semantic target specifications and ordered fallbacks.
- Runtime conditions and checkpoints.
- Capability identity and version information.

Short-lived `ResolvedTarget` values will not be stored in the artifact. They are scoped to one surface, session, and observation and would be unsafe and brittle if reused.

# 3. Determinism & error handling

Discovery is intentionally probabilistic because an LLM selects each next decision. The runtime surrounding that decision is deterministic and bounded.

The model must return one structured decision that validates against the discovery decision schema. Invalid JSON, unsupported actions, missing targets, and invalid fields are rejected. One structured-output retry is allowed. If the second response is still invalid, the run returns `MODEL_DECISION_VALIDATION_FAILED`. There is no unbounded correction loop.

The discovery run has configurable limits for:

- Maximum steps.
- Total run timeout.
- Repeated observations without meaningful progress.
- Model completion.
- Model escalation.
- Policy denial.
- Required human intervention.
- Hard surface-action failure.

Observation fingerprints are produced deterministically from useful state such as URL, title, meaningful visible text, visible control signatures, and dialog signatures. Repeated equivalent states beyond the configured threshold produce a deliberate stuck or dead-end result. The model is not responsible for deciding whether the runtime is stuck.

Target resolution evaluates strategies in order:

```text
0 matches    -> try the next strategy
1 match      -> resolve the target
many matches -> record ambiguity and try the next strategy
```

If all strategies fail, the resolver returns `TARGET_NOT_FOUND` or `TARGET_AMBIGUOUS`. The system never follows a model suggestion to click the first ambiguous match.

The accounts-table read demonstrates structural targeting. It locates the Accounts table, finds the row where Account Type equals Savings, derives the Current Balance column from its header, and reads the corresponding cell. It does not depend on a recorded row or column number.

Runtime application states are handled deliberately:

- Normal state allows discovery to continue.
- Slow loading triggers a bounded condition wait instead of repeated clicking.
- Permission denial returns a structured business outcome.
- Session expiry stops automation with a typed failure.
- Application errors stop with a typed failure.
- Known safe dialogs may be dismissed through normal policy and targeting.
- Unknown or risky dialogs require escalation.

An LLM `complete` decision does not automatically produce success. For the Savings lookup, completion is accepted only when a Savings balance has actually been extracted and the final observation supports the expected account context.

The future replay path will not invoke an LLM for decisions. It will execute the compiled artifact deterministically and verify its declared checkpoint. Replay is not implemented yet.

# 4. Heterogeneity & multi-tenant

The orchestration layer depends on `SurfaceAdapter`, not directly on Playwright. The adapter is responsible for observing the current surface, resolving surface-specific targets, performing actions, evaluating conditions, and capturing in-memory evidence.

The model consumes a surface-neutral observation containing:

- Current location.
- Meaningful visible text.
- Observable controls.
- Dialogs and interstitials.
- Loading state.
- Surface context hints.

Browser handles, cookies, authentication tokens, raw DOM objects, and Playwright locators are excluded.

Model decisions use semantic `TargetSpec` descriptions with ordered strategies such as role and accessible name, label, visible text, structural table relationships, CSS, or XPath. Semantic and structural strategies are preferred, while implementation-specific selectors remain explicit fallbacks.

This creates a seam for future legacy-web or desktop adapters. Another adapter could produce the same observation contract and resolve the same semantic intent using an accessibility tree, OS automation, screenshot coordinates, or another surface mechanism.

Multi-tenant artifact reuse is not implemented yet. The future artifact design should separate reusable vendor-level workflow semantics from tenant-specific origin, route, branding, and selector overrides. Application and tenant versions should be explicit so drift can be detected rather than silently ignored.

# 5. Escalation & handoff

Session ownership is exclusive: `NONE`, `DISCOVERY`, `REPLAY`, or `HUMAN`. Automation can act only while it owns an active session.

Discovery returns `intervention_required` when:

- Policy returns `REQUIRE_HUMAN`.
- The model explicitly requests escalation.
- An unknown or risky dialog is detected.
- The runtime reaches a state that cannot be handled safely.

The intervention record contains enough context for a future operator workflow, including the goal, current step, observation identity, current location, reason code, reason, and relevant evidence.

The existing session lifecycle supports pausing automation, preserving the same BrowserContext and Page, transferring ownership to a human, and returning ownership to automation. This prevents handoff from opening a fresh session and losing application state.

Phase 2 validates the escalation result and control-transfer seam, but it does not implement the full operator interface, real-time co-browsing transport, or complete resume-after-human workflow.

# 6. Safety

Policy enforcement is deterministic and fail-closed. The model cannot bypass, approve, or weaken a policy decision.

The system remains authoritative for risk classification. Model-provided intent may be considered as a hint, but it is not trusted as the final risk value.

Current discovery risk mapping includes:

- Read, navigation, and search actions as `READ_ONLY`.
- Form typing before submission as `REVERSIBLE`.
- Sensitive writes as `SENSITIVE_WRITE`.
- Final create or submit actions as `IRREVERSIBLE`.

Policy outcomes are:

- `ALLOW`: target resolution and execution may continue.
- `DENY`: return a structured policy-blocked failure.
- `REQUIRE_HUMAN`: return `intervention_required`.

Only `ALLOW` reaches target resolution or `SurfaceAdapter.perform()`.

Target cardinality must be exactly one. Missing, stale, detached, foreign, and ambiguous targets are rejected. A cancelled or timed-out mutating browser action invalidates the surface so it cannot complete later without runtime supervision.

Before persistence, evidence is recursively sanitized. API keys, tokens, cookies, authorization values, passwords, browser handles, raw OpenAI responses, and hidden reasoning are not persisted.

Screenshots cannot be sanitized like structured JSON. Persistent screenshots are therefore restricted by the existing evidence policy. The genuine assignment run uses only the fictional banking fixture and explicitly enables synthetic screenshot persistence.

The frozen evidence package was also scanned for common secret patterns and the configured OpenAI API key before being staged.

# 7. Cuts

The current implementation completes the Phase 1 runtime foundation and Phase 2 discovery slice:

- Fictional banking application and deterministic scenarios.
- Browser surface abstraction and Playwright implementation.
- Session ownership and lifecycle management.
- Genuine LLM-driven discovery.
- Typed model decisions and bounded validation retry.
- System-authoritative risk classification.
- Policy enforcement for every proposed action.
- Ordered semantic target resolution.
- Read extraction and discovery working memory.
- Bounded stopping and repeated-state detection.
- Runtime application-state handling.
- Goal completion verification.
- Structured discovery results.
- Sanitized discovery trace, events, screenshots, and final evidence.
- Deterministic fake-model unit and integration tests.
- A genuine successful OpenAI discovery run.

The following are intentionally deferred:

- Final capability artifact schema.
- Discovery-to-artifact compiler.
- Artifact approval, storage, loading, and parameter binding.
- Deterministic replay.
- Replay checkpoints and recovery behavior.
- Replay evidence and exceptional-state demonstration.
- Full human operator UI.
- Complete live human takeover and resume workflow.
- Cross-tenant artifact specialization and drift management.

These are not documented as runnable features because they do not exist yet. The report will be finalized after the remaining artifact, replay, and handoff phases are implemented.
