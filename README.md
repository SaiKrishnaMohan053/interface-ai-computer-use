# Computer-Use Automation System

An interface.ai take-home implementation of policy-controlled computer-use automation against a local synthetic banking application.

## What it demonstrates

The system turns a natural-language goal into a reusable deterministic computer-use capability:

```text
natural-language goal
→ LLM-guided discovery against a live UI
→ typed reusable capability artifact
→ deterministic replay without an LLM
→ explicit business, recovery, and failure outcomes
→ same-session human intervention for risky actions
```

The demo uses fictional banking data only.

## Architecture at a glance

- OpenAI is used only during discovery.
- Model output is converted into typed decisions before browser execution.
- Automated actions pass through validation, risk classification, policy enforcement, semantic target resolution, and the surface adapter.
- Discovery traces and reusable capability artifacts are separate contracts.
- Artifact compilation is deterministic and LLM-free.
- Replay loads saved artifacts and does not call an LLM.
- `SessionManager` enforces exclusive `DISCOVERY`, `REPLAY`, or `HUMAN` ownership.
- Irreversible actions can require same-session human takeover.
- Reviewer evidence is sanitized and integrity-protected.

See `REPORT.md` for the design details and tradeoffs.

## Requirements

- Node.js 24.x
- npm
- Playwright Chromium
- OpenAI API access for the genuine discovery demo

## Setup

```sh
npm ci
npx playwright install chromium
```

## Environment variables

Create the local environment file:

```powershell
Copy-Item .env.example .env
```

Set:

```dotenv
OPENAI_API_KEY=your-api-key
OPENAI_MODEL=your-model-name
```

Do not commit `.env` or credentials.

## OpenAI usage

OpenAI is required only for genuine discovery:

```sh
npm run discover -- ...
```

The following workflows do not use a live model and do not require `OPENAI_API_KEY`:

- build, typecheck, lint, and tests
- compiling the preserved discovery evidence into a capability artifact
- deterministic replay of the saved capability
- business-outcome, recovery, and hard-failure replay scenarios
- the human-in-the-loop demo
- inspection and verification of the frozen evidence packages

This allows the saved artifact and reviewer evidence to be reproduced without additional model calls or API cost.

## Start the demo application

```sh
npm run dev
```

The application is available at:

```text
http://127.0.0.1:3000/member-search
```

Keep this terminal running for the discovery demo.

## Run LLM discovery

In another terminal:

```powershell
npm run discover -- `
  --goal "Look up Alex Morgan and return their current savings balance." `
  --target "http://127.0.0.1:3000/member-search" `
  --headed `
  --synthetic-screenshots
```

This performs genuine model-guided discovery against the live browser UI.

Preserved reviewer evidence:

```text
evidence/discovery-success/
```

## Compile capability artifact

Compile the successful discovery into the reusable capability:

```powershell
npm run compile-artifact -- `
  --source evidence/discovery-success `
  --config config/capabilities/lookup-savings-balance.json
```

Inspect the persisted artifact:

```powershell
Get-Content .\artifacts\lookup_savings_balance\1.0.0.json
```

The discovery trace records one observed run. The capability artifact contains the parameterized workflow needed for deterministic replay.

Compilation is LLM-free.

Reviewer evidence:

```text
evidence/artifact-compilation/
```

## Replay deterministically

Run the successful real-browser replay:

```sh
npx vitest run tests/integration/replay-real-success.test.ts
```

Expected result:

```text
status: success
stepsExecuted: 4
savingsBalance: $12,840.50
```

Replay loads the saved artifact and executes its ordered steps without a model decision loop.

Reviewer evidence:

```text
evidence/replay-success/
```

## Replay exceptional states

Verify that an unknown member is returned as an explicit business outcome rather than a generic failure:

```sh
npx vitest run tests/integration/replay-real-business-outcome.test.ts
```

Expected:

```text
status: business_outcome
code: MEMBER_NOT_FOUND
```

Reviewer evidence:

```text
evidence/replay-member-not-found/
```

Verify deterministic recovery from the known interstitial:

```sh
npx vitest run tests/integration/replay-real-recovery.test.ts
```

The artifact-authorized recovery is bounded and deterministic. No LLM is used for recovery.

Reviewer evidence:

```text
evidence/replay-recovery/
```

Verify structured hard-failure handling:

```sh
npx vitest run tests/integration/replay-real-hard-failure.test.ts
```

Expected:

```text
status: failure
code: APPLICATION_ERROR
```

The failure evidence contains structured step context and a synthetic screenshot without persisting raw browser state.

Reviewer evidence:

```text
evidence/replay-failure/
```

## Human-in-the-loop demo

Start the real same-session handoff demo:

```sh
npm run hitl-demo
```

When Terminal 1 prints an `Intervention ID`, open Terminal 2 in this repository and run:

```sh
npm run intervention:acquire -- <INTERVENTION_ID>
npm run intervention:start -- <INTERVENTION_ID>
```

In the already-open browser, manually click:

```text
Confirm Create Sub-Account
```

After the browser shows:

```text
Sub-account created
```

record the manual action and resume automation:

```sh
npm run intervention:manual-action -- <INTERVENTION_ID> Human completed final synthetic sub-account action
npm run intervention:resume -- <INTERVENTION_ID>
```

The irreversible action is not executed automatically. Policy returns `REQUIRE_HUMAN`, the same live session is handed to the human, and automation resumes only after a fresh observation verifies the resulting state.

Preserved reviewer evidence:

```text
evidence/human-handoff/
```

Verify the frozen handoff package:

```sh
npm run verify-human-handoff-evidence
```

## Evidence

The intentionally small reviewer evidence set is:

```text
evidence/
  artifact-compilation/
  discovery-success/
  human-handoff/
  replay-failure/
  replay-member-not-found/
  replay-recovery/
  replay-success/
```

Each package contains reviewer-oriented metadata and integrity hashes. Evidence avoids raw OpenAI responses, credentials, cookies, browser handles, and raw DOM dumps.

## Tests

Run the complete validation suite:

```sh
npm run typecheck
npm run lint
npm run format:check
npm run build
npm test
```

Focused end-to-end integration checks:

```sh
npx vitest run tests/integration/replay-real-success.test.ts
npx vitest run tests/integration/replay-real-business-outcome.test.ts
npx vitest run tests/integration/replay-real-recovery.test.ts
npx vitest run tests/integration/replay-real-hard-failure.test.ts
npx vitest run tests/integration/human-live-browser-handoff.test.ts
```

## Repository structure

```text
demo-app/        synthetic banking application
src/artifact/    capability schema, compiler, validation, persistence
src/cli/         executable discovery, replay-evidence, and HITL commands
src/conditions/  bounded condition evaluation
src/discovery/   LLM-guided discovery engine
src/evidence/    evidence recording
src/intervention/ human takeover and resume/abort lifecycle
src/policy/      runtime policy enforcement
src/replay/      deterministic artifact replay
src/runtime/     run coordination and typed results
src/security/    persistence redaction
src/session/     browser-session ownership
src/surface/     surface-neutral contracts and Playwright adapter
src/targeting/   semantic target resolution

artifacts/       persisted reusable capabilities
config/          capability compilation configuration
evidence/        frozen reviewer evidence
tests/           unit and integration coverage
```
