# Computer-Use Automation System

An interface.ai take-home implementation for policy-controlled computer-use automation.

The implemented system currently supports:

```text
Natural-language goal
-> genuine LLM-driven discovery against a live browser UI
-> schema validation
-> deterministic risk and policy evaluation
-> semantic target resolution
-> browser execution
-> structured results and sanitized evidence
```

Capability artifact compilation, deterministic replay, and the full human operator interface are not implemented yet.

## Current status

Phase 1 runtime foundations and Phase 2 discovery are complete.

Current functionality includes:

- A fictional banking application with normal and injected runtime scenarios.
- A Playwright browser surface behind a surface-neutral adapter.
- An LLM-driven observe, decide, and act discovery loop.
- Typed model decisions validated before execution.
- System-authoritative risk classification and policy enforcement.
- Ordered semantic target resolution with no first-match guessing.
- Read extraction into discovery run state.
- Bounded max-step, timeout, repeated-state, and failure stopping conditions.
- Structured success, business outcome, intervention, and failure results.
- Sanitized event logs, discovery traces, screenshots, and final results.
- Deterministic fake-model tests that do not call OpenAI.

## Setup

Requirements:

- Node.js 24.x
- npm
- Playwright Chromium
- An OpenAI API key for genuine discovery runs

Install dependencies and Chromium:

```sh
npm ci
npx playwright install chromium
```

Copy the environment template:

```powershell
Copy-Item .env.example .env
```

Configure at least:

```dotenv
OPENAI_API_KEY=your-api-key
OPENAI_MODEL=your-model-name
```

`OPENAI_MODEL` is configurable. Additional timeout, retry, and output-token settings are documented in `.env.example`.

Do not commit `.env` or API keys.

## Start the demo application

Start the fictional banking application:

```sh
npm run dev
```

Open:

```text
http://127.0.0.1:3000/member-search
```

The normal demo path is:

```text
Alex Morgan
-> Member Details
-> Accounts
-> Savings Current Balance
-> $12,840.50
```

All members and financial values are fictional.

## Run genuine discovery

With the demo application running:

```powershell
npm run discover -- `
  --goal "Look up Alex Morgan and return their current savings balance." `
  --target "http://127.0.0.1:3000/member-search" `
  --headed `
  --synthetic-screenshots
```

If `--target` is omitted, the discovery CLI starts and connects to the local demo automatically:

```powershell
npm run discover -- `
  --goal "Look up Alex Morgan and return their current savings balance." `
  --headed `
  --synthetic-screenshots
```

The command prints:

- A structured discovery result.
- Extracted outputs.
- The evidence directory.
- The target URL.

Expected successful output includes:

```json
{
  "status": "success",
  "outputs": {
    "alexMorganSavingsBalance": "$12,840.50"
  }
}
```

The preserved genuine OpenAI run is available under:

```text
evidence/discovery-success/
```

It contains the run metadata, sanitized event log, screenshots, final result, and integrity hashes.

## Run without OpenAI

The deterministic scripted model exercises the discovery runtime without making OpenAI calls:

```sh
npx vitest run tests/integration/scripted-discovery-engine.test.ts
```

Run the focused runtime scenario coverage:

```sh
npx vitest run tests/integration/discovery-scenarios.test.ts
```

These tests cover normal, slow, permission-denied, session-expired, dialog, and application-error behavior.

## Verify

```sh
npm run typecheck
npm run lint
npm run format:check
npm run test:unit
npm run test:integration
npm run build
```

## Safety boundaries

Every actionable model decision follows this order:

```text
LLM decision
-> schema validation
-> system risk classification
-> policy evaluation
-> ALLOW / DENY / REQUIRE_HUMAN
```

Only `ALLOW` reaches target resolution and execution.

Additional guarantees:

- The model cannot override policy decisions.
- Ambiguous targets are never resolved by selecting the first match.
- Risk classification remains system-authoritative.
- Discovery runs have bounded steps, timeout, and repeated-state limits.
- Secrets, tokens, cookies, raw OpenAI responses, and hidden reasoning are not persisted.
- Screenshots and traces follow the existing synthetic-data evidence restrictions.
- Runtime-generated evidence is ignored by Git by default.
- The sanitized `evidence/discovery-success/` package is intentionally preserved for review.

See [REPORT.md](./REPORT.md) for the current design decision notes and deliberate cuts.
