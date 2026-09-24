# Computer-Use Automation System

An interface.ai take-home implementation of policy-controlled computer-use automation.

The implemented flow is:

```text
natural-language goal
-> LLM-guided discovery against a live UI
-> typed capability artifact
-> deterministic replay without the LLM
-> human intervention when required
```

The target application is a local synthetic banking UI with fictional data.

## Setup

Requirements:

- Node.js 24.x
- npm
- Playwright Chromium
- OpenAI API access for the genuine discovery demo

Install dependencies:

```sh
npm ci
npx playwright install chromium
```

Create the local environment file:

```powershell
Copy-Item .env.example .env
```

Set:

```dotenv
OPENAI_API_KEY=your-api-key
OPENAI_MODEL=your-model-name
```

Do not commit `.env` or API keys.

Run the local demo application:

```sh
npm run dev
```

The demo app is available at:

```text
http://127.0.0.1:3000/member-search
```

The repository can be exercised without OpenAI by running the scripted discovery and deterministic replay tests:

```sh
npx vitest run tests/integration/scripted-discovery-engine.test.ts
npx vitest run tests/integration/replay-real-success.test.ts
```

Deterministic replay never calls an LLM.

## Demo path

### 1. Run a genuine LLM-driven discovery goal

Start the demo application:

```sh
npm run dev
```

In another terminal run:

```powershell
npm run discover -- `
  --goal "Look up Alex Morgan and return their current savings balance." `
  --target "http://127.0.0.1:3000/member-search" `
  --headed `
  --synthetic-screenshots
```

A preserved successful genuine discovery run is available at:

```text
evidence/discovery-success/
```

### 2. Compile the discovered workflow into a capability artifact

```powershell
npm run compile-artifact -- `
  --source evidence/discovery-success `
  --config config/capabilities/lookup-savings-balance.json
```

The persisted artifact is:

```text
artifacts/lookup_savings_balance/1.0.0.json
```

### 3. Replay the capability deterministically

Run the real Playwright-backed replay:

```sh
npx vitest run tests/integration/replay-real-success.test.ts
```

Expected result:

```text
status: success
stepsExecuted: 4
savingsBalance: $12,840.50
```

Replay is LLM-free and executes the saved artifact deterministically.

Frozen replay evidence is available at:

```text
evidence/replay-success/
```

### 4. Run the human-in-the-loop handoff demo

```sh
npm run hitl-demo
```

When Terminal 1 prints an `Intervention ID`, open Terminal 2 and run:

```sh
npm run intervention:acquire -- <INTERVENTION_ID>
npm run intervention:start -- <INTERVENTION_ID>
```

Use the already-open headed browser and manually click:

```text
Confirm Create Sub-Account
```

After the browser shows `Sub-account created`, run:

```sh
npm run intervention:manual-action -- <INTERVENTION_ID> Human completed final synthetic sub-account action
npm run intervention:resume -- <INTERVENTION_ID>
```

Frozen same-session handoff evidence is available at:

```text
evidence/human-handoff/
```

Verify it with:

```sh
npm run verify-human-handoff-evidence
```

For the abort path, acquire and start the intervention as above, do not click the final action, and run:

```sh
npm run intervention:abort -- <INTERVENTION_ID>
```

## Verify

```sh
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```

See [REPORT.md](./REPORT.md) for the required design write-up.
