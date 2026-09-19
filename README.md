# Computer-Use Automation System

An interface.ai take-home implementation for policy-controlled computer-use automation.

The implemented flow is:

```text
Natural-language goal
-> LLM-guided discovery against a live UI
-> typed capability artifact
-> deterministic artifact persistence
```

Deterministic replay is the next production execution phase. The full human operator interface is intentionally not implemented.

## Setup

Requirements:

* Node.js 24.x
* npm
* Playwright Chromium
* An OpenAI API key for genuine discovery runs

Install:

```sh
npm ci
npx playwright install chromium
```

Create the local environment file:

```powershell
Copy-Item .env.example .env
```

Configure:

```dotenv
OPENAI_API_KEY=your-api-key
OPENAI_MODEL=your-model-name
```

Do not commit `.env` or API keys.

## Start the demo application

```sh
npm run dev
```

Open:

```text
http://127.0.0.1:3000/member-search
```

The application uses fictional members and financial data.

## Run genuine discovery

```powershell
npm run discover -- `
  --goal "Look up Alex Morgan and return their current savings balance." `
  --target "http://127.0.0.1:3000/member-search" `
  --headed `
  --synthetic-screenshots
```

A preserved successful OpenAI-driven discovery run is available at:

```text
evidence/discovery-success/
```

Discovery produces structured results and sanitized evidence. Raw model responses, secrets, cookies, browser handles, and hidden reasoning are not persisted.

## Capability artifact

A capability artifact is the reusable, typed representation of a successful workflow.

It is deliberately separate from the discovery trace.

The artifact records:

* Capability identity and version.
* Typed inputs and outputs.
* Ordered executable steps.
* Semantic target specifications.
* Preconditions, postconditions, and success conditions.
* Known business outcomes.
* Risk metadata.
* Provenance back to the discovery run.

Invocation-specific values such as the discovered member name or returned balance are parameterized instead of being persisted as reusable workflow data.

The preserved example capability is:

```text
lookup_savings_balance
```

## Compile the artifact

Compile the preserved discovery run with:

```powershell
npm run compile-artifact -- `
  --source evidence/discovery-success `
  --config config/capabilities/lookup-savings-balance.json
```

The command prints:

```text
Capability
Version
Inputs
Outputs
Step count
Risk
Stored path
SHA-256
```

The resulting artifact is stored at:

```text
artifacts/lookup_savings_balance/1.0.0.json
```

Its integrity hash is stored at:

```text
artifacts/lookup_savings_balance/1.0.0.sha256
```

Compilation evidence is preserved under:

```text
evidence/artifact-compilation/
```

## Artifact versioning

Capability versions use semantic versioning.

Persisted versions are immutable. A different artifact cannot overwrite an existing capability version.

The compile CLI may reuse an existing version only when its deterministic serialized content is identical.

## Inspect the artifact

The artifact is plain JSON and can be reviewed directly:

```powershell
Get-Content `
  .\artifacts\lookup_savings_balance\1.0.0.json
```

From that file alone a reviewer can determine:

* What the capability does.
* What input it requires.
* What output it returns.
* Which steps it performs.
* How UI targets are identified.
* Which business outcomes are recognized.
* What proves successful completion.
* What risk metadata applies.
* Which discovery run produced it.

## Run without OpenAI

The deterministic scripted model exercises discovery without calling OpenAI:

```sh
npx vitest run tests/integration/scripted-discovery-engine.test.ts
```

Runtime scenario coverage:

```sh
npx vitest run tests/integration/discovery-scenarios.test.ts
```

## Verify

```sh
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```

## Safety boundaries

Model decisions do not directly control the browser.

```text
LLM decision
-> schema validation
-> system risk classification
-> policy evaluation
-> semantic target resolution
-> surface execution
```

Only policy-approved actions reach execution.

Additional guarantees include:

* Ambiguous targets are never resolved by choosing the first match.
* Risk classification is system-authoritative.
* Discovery execution is bounded by steps, timeout, and repeated-state detection.
* Artifact persistence performs schema, semantic, and security validation.
* Secrets, raw model responses, session state, runtime handles, and invocation-specific values are excluded from reusable artifacts.
* Stored artifacts use deterministic serialization and versioned immutable persistence.

See [REPORT.md](./REPORT.md) for the design decisions and deliberate cuts.
