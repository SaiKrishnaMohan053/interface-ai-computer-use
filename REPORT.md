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
- `SessionManager` owns the live session and actor ownership.
- Evidence components persist sanitized structured events and richer failure evidence.

The core execution model is:

```text
probabilistic discovery
-> deterministic artifact compilation
-> reusable capability artifact
-> deterministic replay
```

The LLM discovers a workflow. The persisted artifact becomes the production execution contract.

Replay does not ask a model what to do next. It loads a validated artifact, binds invocation inputs, executes its ordered steps, re-evaluates policy, verifies conditions, extracts declared outputs, and returns a structured terminal result.

# 2. Artifact schema

The capability artifact is deliberately separate from the discovery trace.

The discovery trace describes what happened during one run. It may contain observations, model decisions, policy results, target-resolution attempts, action results, and temporary extracted values.

The artifact contains only reusable workflow information required for future deterministic execution.

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

Targets are normalized before persistence. Runtime browser handles and discovery-specific model prose are excluded.

The Savings lookup uses structural targeting:

```text
Accounts table
-> row where Account Type = Savings
-> Current Balance column
```

This avoids depending on recorded row indexes, column indexes, or transient browser handles.

Persisted capability versions are immutable. Compatible improvements such as recovery metadata are published as new semantic versions rather than silently replacing an existing artifact.

# 3. Determinism & error handling

Artifact step order is authoritative during replay.

Replay does not use an LLM to choose, reorder, skip, or synthesize actions. Given an artifact and invocation inputs, execution follows the persisted step sequence.

The deterministic path is:

```text
load artifact
-> validate invocation inputs
-> bind input references
-> execute next persisted step
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

Targeting is semantic rather than based on replaying recorded browser handles. `TargetResolver` uses the artifact's ordered target strategies and fails safely when no unique target can be established.

Steps use explicit preconditions and postconditions. Replay therefore verifies required state instead of assuming that a previous click or navigation succeeded.

Waits are bounded. Condition polling uses explicit timeouts and polling intervals; replay does not wait indefinitely for a surface to become ready.

The artifact also defines a final success condition. The successful replay path verifies the declared output and final UI checkpoint rather than treating completion of the last action alone as proof of success.

Replay distinguishes five result classes:

```text
success
business outcome
recoverable condition
hard failure
intervention required
```

`success` means the capability completed with its required outputs and checkpoints satisfied.

A `business outcome` is an expected domain result that the caller needs to know about, not a system failure. For example:

```text
MEMBER_NOT_FOUND
```

A `recoverable condition` is a known runtime state for which the artifact explicitly declares deterministic recovery.

A `hard failure` stops execution and returns a typed error. Failure evidence records the failing step and, where available, expected state, observed state, and richer evidence such as a screenshot.

`intervention_required` means automation cannot safely continue without transferring control to a human.

Recovery is deliberately narrow:

```text
known condition
+ artifact-authorized recovery
+ bounded attempt budget
= deterministic recovery
```

Replay does not improvise recovery with an LLM. Unknown conditions, exhausted recovery, ambiguous targets, policy blocks, unrecoverable session state, and application failures do not trigger open-ended autonomous behavior.

The preserved replay evidence demonstrates:

```text
normal success
MEMBER_NOT_FOUND business outcome
known-interstitial recovery followed by success
APPLICATION_ERROR hard failure with screenshot evidence
```

# 4. Heterogeneity & multi-tenant

The workflow contract is separated from Playwright through `SurfaceAdapter`.

Artifacts describe semantic intent rather than browser-specific runtime handles. Target strategies can represent accessible role/name relationships, labels, visible text, structural relationships, and explicit fallback strategies.

A legacy-web, desktop, accessibility-tree, or screenshot-based adapter could implement the same surface contract while resolving artifact-level target intent using technology appropriate to that surface.

Application compatibility metadata is explicit so vendor versions and tenant-specific variants can be checked rather than silently assumed compatible.

For multi-tenant deployment, the intended model is a shared base capability for a vendor/application family with controlled compatibility metadata and versioned specialization where tenant differences require it.

Full cross-tenant specialization, drift detection, and desktop adapters are not implemented in this take-home.

# 5. Escalation & handoff

Session ownership is explicit:

```text
NONE
DISCOVERY
REPLAY
HUMAN
```

Only one actor owns a live session at a time.

Discovery or replay can produce `intervention_required` when automation cannot safely proceed, including policy-required human involvement or an unrecoverable deterministic condition.

The session architecture is designed so intervention refers to the existing live browser session rather than creating a new one. Ownership can move from automation to `HUMAN`, preventing automated actions while the human owns the session.

The complete production operator console and end-user co-browsing experience are deliberately outside the take-home scope. The important seam is explicit ownership, preserved session context, and a typed intervention result rather than silently continuing automation.

# 6. Safety

Artifacts do not bypass policy.

A capability artifact describes what replay intends to do, but every actionable replay step is authorized again at runtime.

The replay safety path is:

```text
artifact step
-> runtime risk classification / stored-risk enforcement
-> policy evaluation
-> semantic target resolution
-> surface execution
```

An artifact cannot make an otherwise disallowed action permissible.

Policy evaluates allowed origins, routes, action kinds, and risk rules. Runtime enforcement also prevents a stored artifact from downgrading system-authoritative risk.

Only an allowed action reaches the surface.

Other fail-closed behaviors include:

- Ambiguous targets are not resolved by choosing the first match.
- Invalid invocation inputs fail before normal browser execution.
- Recovery is limited to known, artifact-authorized conditions.
- Unknown or exhausted recovery can require intervention.
- Application errors stop replay rather than being interpreted as normal state.
- Replay contains no LLM decision loop.

Artifact persistence also performs schema, semantic, and security validation.

Reusable artifacts exclude:

- API keys and secrets.
- Cookies and authentication state.
- Browser or Playwright handles.
- Raw model responses.
- Hidden reasoning.
- Raw DOM state.
- Session state.
- Screenshots and trace payloads.
- Invocation-specific member names and returned financial values.

Evidence is sanitized before persistence. Hard-failure evidence can include screenshots because the demo uses synthetic fixture data.

# 7. Cuts

The implemented vertical slice includes:

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
-> structured replay evidence
```

The replay evidence includes real Playwright executions for success, a known business outcome, deterministic recovery, and a hard application failure.

Deliberate cuts are:

- A full human operator UI / co-browsing console.
- Production-grade resume-after-human UX.
- Desktop and accessibility-tree surface implementations.
- Cross-tenant artifact specialization and automated drift management.
- Distributed scheduling or browser-farm infrastructure.
- Artifact approval workflows.
- LLM-assisted replay fallback.

These are left at explicit architectural seams rather than represented as implemented functionality. The take-home focuses on the load-bearing path: genuine discovery, a deliberate reusable artifact contract, deterministic policy-controlled replay, explicit runtime outcomes, and reviewer-verifiable evidence.
