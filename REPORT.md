# 1. Architecture

The system is a TypeScript modular monolith using Node.js, Playwright, Zod, and Vitest.

The main boundaries are:

* `DiscoveryEngine` runs the bounded LLM-guided observe, decide, authorize, and act loop.
* `DiscoveryDecisionModel` isolates LLM participation.
* `SurfaceAdapter` separates orchestration from concrete UI technology.
* `PlaywrightSurface` implements browser interaction.
* `PolicyEngine` performs deterministic authorization.
* `TargetResolver` resolves ordered semantic targets.
* `SessionManager` owns the live session and actor ownership.
* `ArtifactCompiler` converts a successful discovery run into a reusable capability artifact.
* `ArtifactStore` validates and persists immutable artifact versions.

The core separation is:

```text
probabilistic discovery
-> deterministic compiler
-> reusable capability artifact
```

The model discovers the workflow, but it does not define the persisted runtime contract directly.

# 2. Artifact schema

The capability artifact is not the discovery trace.

The discovery trace describes what happened during one run. It may contain observations, decisions, policy results, target-resolution attempts, action results, and extracted working values.

The artifact contains only the reusable workflow required for future deterministic execution.

The artifact includes:

* Stable capability identity and semantic version.
* Application compatibility metadata.
* Typed required and optional inputs.
* Typed outputs.
* Ordered steps.
* Semantic target specifications.
* Preconditions and postconditions.
* Wait and recovery metadata.
* Known business outcomes.
* Success conditions.
* Risk metadata.
* Provenance.

Inputs and outputs are explicit contracts. For the example capability:

```text
input:
memberName:string

output:
savingsBalance:currency
```

Concrete discovery values are parameterized. The reusable artifact therefore stores an input reference instead of the discovered member name and an output binding instead of the returned balance.

Targets are also normalized before persistence. The artifact stores reusable semantic descriptions such as accessible role/name relationships and structural table queries rather than runtime element handles or discovery-specific model prose.

The Savings lookup demonstrates structural targeting:

```text
Accounts table
-> row where Account Type = Savings
-> Current Balance column
```

This does not depend on recorded row or column positions.

# 3. Determinism & error handling

Discovery is intentionally probabilistic because the LLM chooses each next action.

Artifact compilation is deterministic.

Given the same successful discovery source and the same compile configuration, the compiler produces the same serialized capability artifact and SHA-256 hash.

Compilation performs:

```text
successful discovery path extraction
-> parameterization
-> target normalization
-> artifact construction
-> schema validation
-> semantic validation
-> security validation
-> deterministic serialization
-> versioned persistence
```

Only successful, policy-approved discovery actions are eligible for the artifact. Failed attempts, retries, completion decisions, model-control events, and unrelated runtime noise are not compiled into executable steps.

Stored capability versions are immutable. A different artifact cannot silently replace an existing version.

The artifact also declares explicit success conditions and known business outcomes so future replay does not have to infer success from the final page state.

Deterministic replay itself is intentionally deferred to the next phase.

# 4. Heterogeneity & multi-tenant

The workflow contract is separated from Playwright through `SurfaceAdapter`.

Artifacts describe semantic intent rather than browser-specific runtime handles. Target strategies can include accessible role/name relationships, labels, visible text, structural relationships, and explicit selector fallbacks.

A future browser, legacy-web, desktop, accessibility-tree, or screenshot-based adapter can resolve the same artifact-level target intent using its own surface implementation.

Application compatibility metadata is explicit in the artifact so future vendor versions or tenant-specific variants can be checked rather than silently assumed compatible.

Full multi-tenant specialization and drift management are not implemented.

# 5. Escalation & handoff

Session ownership is explicit:

```text
NONE
DISCOVERY
REPLAY
HUMAN
```

Discovery can produce `intervention_required` when policy requires a human, the model explicitly escalates, or the runtime cannot safely continue.

The session layer already supports preserving the same browser context while ownership transfers between automation and a human.

A complete operator interface and production resume-after-human workflow are intentionally deferred.

# 6. Safety

Policy and artifact persistence both fail closed.

During discovery:

```text
model decision
-> schema validation
-> system risk classification
-> policy evaluation
-> target resolution
-> execution
```

Only `ALLOW` reaches execution.

Before artifact persistence, the compiler and store enforce:

* Schema validation.
* Semantic validation.
* Security validation.
* Deterministic serialization.
* Immutable versioned persistence.

The persisted artifact excludes:

* API keys and secrets.
* Cookies and authentication state.
* Browser or Playwright handles.
* Raw model responses.
* Hidden reasoning.
* Raw DOM state.
* Session state.
* Screenshots and trace payloads.
* Invocation-specific member names and financial values.

The artifact retains provenance without retaining the sensitive discovery transcript. The example artifact records the discovery run identifier, compiler version, source goal, and compile timestamp.

# 7. Cuts

The implemented vertical slice currently includes:

```text
natural-language goal
-> genuine LLM-driven discovery
-> policy-controlled UI execution
-> successful-run evidence
-> deterministic artifact compilation
-> typed parameterized capability
-> validated versioned persistence
-> integrity hash and compilation evidence
```

The following remain intentionally deferred:

* Deterministic replay without the LLM.
* Replay checkpoints and recovery execution.
* Replay evidence and exceptional-state demonstration.
* Full human operator UI and production takeover workflow.
* Cross-tenant specialization and drift management.
* Artifact approval workflow.

These are deferred at clean architectural boundaries rather than represented as implemented features.
