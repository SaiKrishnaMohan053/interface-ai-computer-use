# Computer-Use Automation System

An interface.ai take-home implementation for policy-controlled computer-use automation.

The implemented flow is:

```text
Natural-language goal
-> LLM-guided discovery against a live UI
-> typed capability artifact
-> immutable artifact persistence
-> deterministic replay without the LLM
-> structured outcomes, recovery, failure evidence
```

The target application is a local synthetic banking UI using fictional members and financial data.

The full operator UI is intentionally not implemented.

## Setup

Requirements:

- Node.js 24.x
- npm
- Playwright Chromium
- An OpenAI API key for genuine discovery runs

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

Discovery persists sanitized structured evidence. Raw model responses, secrets, cookies, browser handles, and hidden reasoning are not persisted.

## Capability artifact

A capability artifact is the typed, reusable representation of a successful discovered workflow.

The preserved capability is:

```text
lookup_savings_balance
```

It declares:

```text
input:
  memberName: string

output:
  savingsBalance: currency
```

The artifact also contains ordered steps, semantic targets, conditions, known business outcomes, risk metadata, and provenance.

Invocation-specific values are passed at replay time rather than hard-coded into the reusable workflow.

## Compile the artifact

Compile the preserved discovery run with:

```powershell
npm run compile-artifact -- `
  --source evidence/discovery-success `
  --config config/capabilities/lookup-savings-balance.json
```

The base artifact is stored at:

```text
artifacts/lookup_savings_balance/1.0.0.json
```

Its SHA-256 sidecar is:

```text
artifacts/lookup_savings_balance/1.0.0.sha256
```

Replay scenarios that include known business outcomes and recovery use the compatible patch artifact:

```text
artifacts/lookup_savings_balance/1.0.1.json
artifacts/lookup_savings_balance/1.0.1.sha256
```

Persisted capability versions are immutable.

## Replay a capability

Replay is deterministic and does not invoke an LLM for decisions.

The replay entry point is the typed `ReplayEngine` request:

```ts
await engine.runOrderedSteps({
  capabilityId: 'lookup_savings_balance',
  version: '1.0.0',
  inputs: {
    memberName: 'Alex Morgan',
  },
  target: {
    entryUrl: 'http://127.0.0.1:3000/member-search',
  },
  options: {
    timeoutMs: 10_000,
  },
});
```

Inputs are supplied through the `inputs` object.

For example:

```ts
inputs: {
  memberName: 'Alex Morgan',
}
```

Replay validates declared inputs before executing browser steps. Input references in the artifact are bound to the supplied invocation values in memory; the persisted artifact is not modified.

## Run the success scenario

Runs the real capability against the real Playwright-backed demo UI:

```sh
npx vitest run tests/integration/replay-real-success.test.ts
```

Expected result:

```text
status: success
stepsExecuted: 4
savingsBalance: $12,840.50
```

Frozen reviewer evidence:

```text
evidence/replay-success/
```

## Run the business-outcome scenario

```sh
npx vitest run tests/integration/replay-real-business-outcome.test.ts
```

This invokes the capability with an unknown synthetic member.

Expected result:

```text
status: business_outcome
code: MEMBER_NOT_FOUND
```

`MEMBER_NOT_FOUND` is treated as an expected business result rather than a system failure.

Frozen reviewer evidence:

```text
evidence/replay-member-not-found/
```

## Run the recovery scenario

```sh
npx vitest run tests/integration/replay-real-recovery.test.ts
```

This runs the artifact against the known-interstitial demo scenario.

Expected flow:

```text
known interstitial detected
-> artifact-authorized bounded recovery
-> interstitial dismissed
-> replay resumes
-> success
```

Frozen reviewer evidence:

```text
evidence/replay-recovery/
```

## Run the hard-failure scenario

```sh
npx vitest run tests/integration/replay-real-hard-failure.test.ts
```

This runs against the injected application-error scenario.

Expected result:

```text
status: failure
code: APPLICATION_ERROR
stepId: enter-member-search
```

Failure evidence includes structured expected/observed context and a screenshot.

Frozen reviewer evidence:

```text
evidence/replay-failure/
```

## Regenerate frozen replay evidence

Run all four reviewer replay scenarios and regenerate their evidence packages:

```sh
npm run freeze-replay-evidence
```

This produces:

```text
evidence/
├── replay-success/
├── replay-member-not-found/
├── replay-recovery/
└── replay-failure/
```

Each frozen package contains sanitized run metadata, structured events, the terminal result, and SHA-256 integrity hashes. The hard-failure package also includes screenshot evidence.

## Inspect the artifact

```powershell
Get-Content `
  .\artifacts\lookup_savings_balance\1.0.0.json
```

From the artifact alone a reviewer can determine:

- What the capability does.
- Which typed inputs it requires.
- Which typed outputs it returns.
- Which ordered steps it executes.
- How controls are targeted.
- Which business outcomes are recognized.
- Which conditions define successful execution.
- Which risk metadata applies.
- Which discovery run produced it.

## Run discovery without OpenAI

The scripted discovery model exercises the discovery loop without calling OpenAI:

```sh
npx vitest run tests/integration/scripted-discovery-engine.test.ts
```

Runtime discovery scenario coverage:

```sh
npx vitest run tests/integration/discovery-scenarios.test.ts
```

Deterministic replay itself never uses OpenAI.

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

Deterministic replay follows the persisted artifact rather than asking a model for the next action.

Additional guarantees include:

- Every actionable replay step is policy checked.
- Allowed origins, routes, actions, and risk levels are explicit.
- Runtime risk cannot downgrade artifact or system risk.
- Ambiguous targets fail safely.
- Replay steps execute in persisted artifact order.
- Declared inputs are validated before execution.
- Known business outcomes are distinct from failures.
- Known recovery is bounded and artifact-authorized.
- Application failures stop replay with structured evidence.
- Secrets, raw model responses, session state, browser handles, and invocation-specific values are excluded from reusable artifacts.
- Reviewer evidence is sanitized before persistence.

See [REPORT.md](./REPORT.md) for architecture decisions, trade-offs, escalation design, safety boundaries, and deliberate cuts.
