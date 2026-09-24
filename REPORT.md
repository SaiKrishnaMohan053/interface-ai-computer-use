# 1. Architecture

The system is a single-process TypeScript application built around explicit boundaries rather than distributed infrastructure. `DiscoveryEngine` performs bounded LLM-guided observation and decision-making against a live UI. Model output is converted into typed decisions; it does not directly control the browser. Before an automated action executes, the system validates the decision, classifies risk, evaluates `PolicyEngine`, resolves a semantic target, verifies session ownership, and then delegates the action to a `SurfaceAdapter`.

`PlaywrightSurface` is the current concrete surface implementation. `SessionManager` owns the live `BrowserContext` and `Page` and enforces exclusive `DISCOVERY`, `REPLAY`, or `HUMAN` ownership. Successful discovery is compiled by `ArtifactCompiler` into a validated, versioned capability stored by `ArtifactStore`. `ReplayEngine` then executes that artifact deterministically without an LLM. Evidence components persist sanitized structured events plus selected richer evidence such as screenshots for failure and handoff cases.

The key trade-off is a modular monolith instead of queues, services, or a browser farm. For this take-home, the hard problem is the contract between discovery, policy, artifacts, replay, and human control transfer. Keeping those boundaries in one process makes correctness and reviewability easier while preserving seams that could later be separated operationally.

# 2. Artifact schema

The artifact is a reusable capability contract, not a raw discovery transcript. A discovery trace records what happened in one probabilistic run; the artifact keeps only the information needed to invoke the capability again safely and deterministically.

The schema contains stable identity and semantic versioning, application/surface compatibility metadata, typed inputs and outputs, ordered executable steps, semantic targets, preconditions and postconditions, bounded wait/recovery metadata, known business outcomes, a final success condition, risk metadata, and provenance.

Invocation-specific values are parameterized. For example, the discovered member name becomes an `inputRef` (`memberName:string`) and the extracted balance becomes an `outputRef` (`savingsBalance:currency`) rather than persisting `Alex Morgan` or the discovered balance as reusable logic. Targets are semantic and may use role/name, labels, visible text, or structural relationships. The Savings lookup, for example, targets the Accounts table row where `Account Type = Savings` and reads the `Current Balance` column rather than storing row indexes or browser handles.

Artifacts are validated before persistence and stored as immutable semantic versions. Compatibility and provenance allow the runtime to decide whether a saved capability is appropriate for a given application/version while keeping the discovery evidence separate from the production execution contract.

# 3. Determinism & error handling

Replay treats artifact step order as authoritative. There is no LLM in the replay decision loop. For each step, the runtime evaluates known runtime state and authorized recovery, verifies preconditions, observes the current surface, re-evaluates system risk and policy, checks automation ownership before target resolution, resolves the semantic target, checks ownership again immediately before execution, performs the declared action, extracts outputs when applicable, verifies postconditions, and finally verifies the artifact success condition.

Determinism comes from typed actions, ordered semantic target strategies, unique-target requirements, bounded waits, explicit checkpoints, and final success verification. Target resolution fails safely if no unique target can be established; replay does not choose an arbitrary first match. Recovery is also bounded and artifact-authorized rather than improvised by a model.

The result model separates four important non-success cases. A **\*\*business outcome\*\*** is an expected domain result, for example `MEMBER_NOT_FOUND`. A **\*\*recoverable runtime condition\*\*** is a known state with deterministic recovery, for example `KNOWN_INTERSTITIAL`, which can be dismissed only when the artifact authorizes that recovery and the recovery budget permits it. A **\*\*hard failure\*\***, for example `APPLICATION_ERROR`, stops replay and returns structured context including the failing step and available expected/observed evidence. **\*\*Intervention required\*\*** is returned when automation cannot safely proceed and human ownership is required.

UI drift is detected indirectly through compatibility mismatch, target-resolution failure, pre/postcondition failure, final-success mismatch, or degrading replay stability. Those signals fail or escalate rather than silently changing the recorded flow.

# 4. Heterogeneity & multi-tenant

`SurfaceAdapter` is the seam between capability semantics and concrete computer-use technology. The artifact describes actions, semantic targets, observations, and conditions without depending on Playwright runtime handles. `PlaywrightSurface` implements that contract today. The same artifact-level model could be supported by a legacy-web/accessibility adapter, a desktop accessibility adapter, or a screenshot/vision-and-coordinate adapter, each responsible for observing and resolving the same semantic intent on its own surface.

For multi-tenant reuse, the intended model is a base capability associated with a vendor/application family plus explicit version/variant compatibility. Tenants running the same underlying product should reuse the base artifact when compatible. Where a tenant or product version differs, a future specialization layer could provide versioned target/condition overrides rather than re-recording the entire capability.

Drift signals would include application/version mismatch, semantic target resolution failures, checkpoint mismatches, and replay-stability degradation across runs. Those signals would trigger review, specialization, or re-discovery rather than silent per-tenant mutation. The current implementation does not claim a production multi-tenant runtime, cross-tenant override store, or non-browser adapter; it keeps the core contracts compatible with those extensions.

# 5. Escalation & handoff

Automation can escalate when policy marks an action `REQUIRE_HUMAN`, when a condition is unsafe or unsupported, when deterministic recovery is exhausted, or when execution is otherwise stuck. The intervention request records enough context to act: run/session identity, source actor, capability and step where applicable, reason code, observed state, and evidence references.

The handoff is performed on the same live session. Automation first pauses; `SessionManager` then transfers exclusive ownership from `DISCOVERY` or `REPLAY` to `HUMAN`. The operator acts in the existing headed `BrowserContext` and `Page`; browser state is not recreated. Manual actions and control transitions are recorded in the intervention audit trail.

The operator may resume or abort. On resume, ownership returns to the source automation actor and the runtime takes a fresh observation rather than trusting the pre-handoff state. It verifies the paused step's postcondition and continues only from the state actually left by the human. This prevents replay from duplicating an irreversible action that the human already completed. On abort, automation is not resumed and the run is finalized with a structured terminal failure.

Evidence continuity spans the same run, session, and intervention identifiers so the reviewer can follow automation pause, HUMAN acquisition, manual resolution, control return, fresh re-observation, and final verification as one live-session timeline.

# 6. Safety

Safety is enforced outside the LLM. `PolicyEngine` uses explicit allowlists for permitted origins, routes, action kinds, and risk rules, producing `ALLOW`, `DENY`, or `REQUIRE_HUMAN`. Risk classification is system-authoritative; a model decision or persisted artifact cannot lower the effective risk of an action. Replay re-evaluates policy at runtime instead of treating artifact creation as permanent authorization.

Ownership is another hard boundary: automated execution is rejected while `HUMAN` owns the paused session. After runtime policy allows an automated action, ownership is checked before semantic target resolution and checked again immediately before surface execution. Ambiguous semantic targets fail closed, waits and recovery are bounded, and irreversible actions can require human control rather than automatic execution.

Persistence is sanitized before write. Artifacts and reviewer evidence exclude credentials, API keys, cookies/authentication state, raw model responses, hidden reasoning, browser/runtime handles, and other non-reusable session state. Artifact validation/security checks reject unsupported or unsafe persisted content, and frozen evidence packages include integrity hashes.

The limits are intentional: this is not a production authorization service, identity system, or regulated-data platform. The demo uses synthetic financial data, the policy rules are local configuration, and the operator surface is minimal. A production deployment would need enterprise authentication/authorization, tenant-aware policy administration, audit retention controls, and stronger data-governance integration.

# 7. Cuts

I intentionally cut infrastructure and product surface area that was not necessary to prove the end-to-end control model:

- no real bank integration or real customer data;

- no production operator/co-browsing console;

- no production operator identity, approval, or permission system;

- no desktop or accessibility-tree surface implementation;

- no production multi-tenant runtime or tenant-specific override service;

- no distributed scheduler or browser farm;

- no artifact approval/governance workflow;

- no open-ended LLM recovery during replay.

These cuts prioritize a thin but real vertical slice: genuine LLM discovery against a live UI, a reusable typed capability artifact, deterministic policy-controlled replay with explicit outcomes and recovery, real same-session human takeover, safety enforcement, and reviewer-verifiable evidence. With more time, I would build tenant/version override management and drift telemetry first, then a production operator console and additional surface adapters, before introducing distributed execution infrastructure.
