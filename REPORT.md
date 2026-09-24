# 1. Architecture

The system is a TypeScript modular monolith using Node.js, Playwright, Zod, and Vitest.

The main boundaries are:

- `DiscoveryEngine` runs the bounded LLM-guided observe, decide, authorize, and act loop.
- `DiscoveryDecisionModel` isolates LLM participation.
- `ArtifactCompiler` converts a successful discovery run into a reusable capability.
- `ArtifactStore` validates and persists immutable artifact versions.
- `ReplayEngine` executes persisted artifact steps deterministically without an LLM.
- `PolicyEngine` performs deterministic authorization during discovery and replay.
- `TargetResolver` resolves ordered semantic targets.
- `SurfaceAdapter` separates orchestration from concrete UI technology.
- `PlaywrightSurface` implements browser interaction.
- `SessionManager` owns the live browser session and exclusive actor ownership.
- Intervention components pause automation, route human work, transfer ownership, resume or abort, and preserve evidence continuity.
- Evidence components persist sanitized structured events and richer failure or handoff evidence.

The core execution model is:

```text
probabilistic discovery
-> deterministic artifact compilation
-> reusable capability artifact
-> deterministic replay
-> human escalation when automation cannot safely continue
```

The LLM discovers a workflow. The persisted artifact becomes the production execution contract. Replay does not ask a model what to do next: it loads a validated artifact, binds invocation inputs, executes ordered steps, re-evaluates policy, verifies conditions, extracts declared outputs, and returns a structured result.

# 2. Artifact schema

The capability artifact is deliberately separate from the discovery trace.

The discovery trace records what happened during one run. The artifact contains only reusable workflow information required for future deterministic execution.

It includes:

- Stable capability identity and semantic version.
- Application compatibility metadata.
- Typed required and optional inputs.
- Typed outputs.
- Ordered executable steps.
- Semantic target specifications.
- Preconditions and postconditions.
- Wait and recovery metadata.
- Known business outcomes.
- A final success condition.
- Risk metadata.
- Provenance.

For the example capability:

```text
input:
  memberName:string

output:
  savingsBalance:currency
```

Invocation-specific discovery values are parameterized. The reusable artifact stores an input reference rather than `Alex Morgan`, and an output binding rather than the discovered balance.

Targets are normalized before persistence. Runtime browser handles and discovery-specific model prose are excluded. The Savings lookup uses structural targeting:

```text
Accounts table
-> row where Account Type = Savings
-> Current Balance column
```

This avoids depending on recorded row indexes, column indexes, or transient browser handles.

Persisted capability versions are immutable. Compatible changes are published as new semantic versions rather than silently replacing an existing artifact.

# 3. Determinism & error handling

Artifact step order is authoritative during replay.

Replay does not use an LLM to choose, reorder, skip, or synthesize actions. Given an artifact and invocation inputs, execution follows the persisted step sequence:

```text
load artifact
-> validate invocation inputs
-> bind input references
-> evaluate policy
-> resolve semantic target
-> verify preconditions
-> perform action
-> extract declared output if applicable
-> verify postconditions
-> continue in artifact order
-> verify final success condition
-> return structured result
```

Targeting is semantic rather than based on replaying recorded browser handles. `TargetResolver` uses ordered target strategies and fails safely when no unique target can be established.

Steps use explicit preconditions and postconditions. Waits are bounded. The final success condition is verified explicitly rather than assuming the last action succeeded.

Replay distinguishes:

```text
success
business outcome
recoverable condition
hard failure
intervention required
```

A business outcome is an expected domain result, such as `MEMBER_NOT_FOUND`, rather than a system crash. Recoverable conditions are known states with explicit bounded recovery. Hard failures stop execution and return typed error context including the failing step and, where available, expected state, observed state, and screenshot evidence.

Recovery is deliberately narrow:

```text
known condition
+ artifact-authorized recovery
+ bounded attempt budget
= deterministic recovery
```

Replay does not improvise recovery with an LLM. Unknown conditions, exhausted recovery, ambiguous targets, policy blocks, unrecoverable session state, and application failures stop or escalate deliberately.

Reviewer evidence includes real Playwright runs for normal success, `MEMBER_NOT_FOUND`, known-interstitial recovery, and an `APPLICATION_ERROR` hard failure.

# 4. Heterogeneity & multi-tenant

The workflow contract is separated from Playwright through `SurfaceAdapter`.

Artifacts describe semantic intent rather than browser-specific runtime handles. Target strategies can represent accessible role/name relationships, labels, visible text, structural relationships, and explicit fallbacks.

A legacy-web, desktop, accessibility-tree, or screenshot-based adapter could implement the same surface contract while resolving artifact-level target intent using technology appropriate to that surface.

Application compatibility metadata is explicit so vendor versions and tenant-specific variants can be checked rather than silently assumed compatible.

For multi-tenant deployment, the intended model is a shared base capability for a vendor/application family with controlled compatibility metadata and versioned specialization where tenant differences require it.

Full cross-tenant specialization, automated drift management, and non-browser surface adapters are not implemented in this take-home.

# 5. Escalation & handoff

Automation escalates when it cannot safely continue. Triggers include a risky or irreversible action that policy marks `REQUIRE_HUMAN`, an unknown or unsupported runtime condition, exhausted deterministic recovery, or a stuck state.

The intervention request records the context needed for a human to act: run/session identity, source actor, capability and step when applicable, reason code and reason, observed state, and evidence references.

The control-transfer sequence is:

```text
DISCOVERY or REPLAY owns live session
-> automation reaches intervention_required
-> intervention request is persisted
-> session is paused
-> HUMAN explicitly acquires ownership
-> human uses the same live BrowserContext/Page
-> human performs manual work
-> human records the manual action
-> human chooses RESUME or ABORT
```

`SessionManager` enforces exclusive ownership. A live session has one owner at a time: `DISCOVERY`, `REPLAY`, `HUMAN`, or no owner when inactive. While `HUMAN` owns the paused session, automated browser actions are rejected immediately before surface execution.

The human operates the same headed browser session that automation was using; a fresh browser session is not created. This preserves navigation state, cookies/session context inside the live browser, and the evidence timeline.

On resume, ownership returns to the source automation actor. Replay does not trust the pre-handoff observation or blindly repeat the paused action. It takes a fresh observation, re-checks the paused-step postcondition, and continues only from the state actually left by the human. In the included risky-action demo, the human completes the synthetic final action and replay observes `Sub-account created` without issuing a duplicate irreversible click.

On abort, automation is not resumed. The run terminates with a structured `ACTION_FAILED` result whose observed reason is `HUMAN_ABORTED`, and the live session is finalized.

Evidence remains continuous across the handoff. The preserved reviewer package records checkpoints for:

```text
BEFORE_INTERVENTION
HUMAN_CONTROL
HUMAN_RESOLUTION
AUTOMATION_RESUMED
```

The full co-browsing/operator-console product is intentionally out of scope; the implemented operator surface is a minimal CLI/control-server workflow over the real same-session ownership mechanism.

# 6. Safety

Safety is enforced outside the LLM.

Model output does not directly own browser execution. Discovery decisions are schema-validated, system risk-classified, policy-checked, target-resolved, and only then executed by the surface adapter.

Artifacts also do not bypass policy. Every actionable replay step is re-authorized at runtime:

```text
artifact step
-> system-authoritative risk classification
-> stored-risk enforcement
-> policy evaluation
-> semantic target resolution
-> ownership check
-> surface execution
```

Policy uses explicit allowlists for permitted origins, routes, action kinds, and risk rules. A stored artifact cannot downgrade system-authoritative risk or make a disallowed action permissible.

Risky and irreversible actions are handled conservatively. The synthetic `Confirm Create Sub-Account` action is classified as `IRREVERSIBLE` and requires human intervention; automation does not execute it automatically.

Exactly one actor controls a live session. Ownership is checked immediately before automated surface execution, so automation cannot begin a browser action while `HUMAN` owns the paused session.

Replay is LLM-free. It follows the persisted artifact and deterministic recovery rules rather than asking a model for the next action or for open-ended recovery.

Persistence is sanitized before write. Reusable artifacts and reviewer evidence exclude secrets, API keys, cookies/authentication state, raw model responses, hidden reasoning, browser/runtime handles, and other non-reusable session state. Structured reviewer evidence was audited for forbidden raw runtime-state terms, and evidence packages include integrity manifests.

Other fail-closed behavior includes:

- Ambiguous targets are not resolved by choosing the first match.
- Invalid invocation inputs fail before normal browser execution.
- Recovery is limited to known, authorized conditions.
- Unknown or exhausted recovery can escalate.
- Application failures stop replay instead of being treated as normal state.
- Human resume requires a fresh observation of the live state.
- Human abort prevents further automated execution.

Limits: the policy model is configuration-driven rather than a production authorization service; the demo uses synthetic data; screenshots are permitted because the fixture is synthetic; and the implementation does not provide a production co-browsing UI or enterprise identity/approval workflow.

# 7. Cuts

The implemented vertical slice covers the required end-to-end path:

```text
natural-language goal
-> genuine LLM-driven discovery
-> policy-controlled UI execution
-> successful discovery evidence
-> deterministic artifact compilation
-> typed parameterized capability
-> immutable versioned persistence
-> deterministic replay without an LLM
-> runtime input binding
-> semantic target resolution
-> replay policy enforcement
-> bounded conditions and recovery
-> business-outcome handling
-> hard-failure detection
-> human escalation
-> same-session HUMAN takeover
-> resume or abort
-> continuous reviewer evidence
```

Deliberate cuts are:

- A full real-time human operator UI / co-browsing console.
- Production operator identity, authentication, approval, and queueing workflows.
- Desktop and accessibility-tree surface implementations.
- Cross-tenant artifact specialization and automated drift management.
- Distributed scheduling or browser-farm infrastructure.
- Artifact approval workflows.
- LLM-assisted replay fallback.

These are left at explicit seams rather than represented as implemented functionality. The take-home focuses on the load-bearing requirements: genuine discovery, a reusable artifact contract, deterministic policy-controlled replay, explicit runtime outcomes, real same-session human handoff, safety enforcement, and reviewer-verifiable evidence.
