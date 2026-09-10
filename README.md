# Computer-Use Automation System

An interface.ai take-home implementation for policy-controlled computer-use automation.

The target flow is:

```text
Natural-language goal
â†’ LLM-guided discovery against a live UI
â†’ typed capability artifact
â†’ deterministic replay without the LLM
â†’ human intervention when required
```

## Current status

Phase 1 runtime foundations are complete:

- Fictional banking demo with deterministic normal and failure scenarios.
- Surface-neutral observation, action, condition, result, and evidence contracts.
- Playwright browser surface with headed/headless support.
- Session lifecycle and exclusive `DISCOVERY`, `REPLAY`, or `HUMAN` ownership.
- Ordered target resolution and semantic table-cell targeting.
- Bounded condition polling with explicit timeouts.
- Typed runtime outcomes and recoverable conditions.
- Fail-closed origin, route, action, and risk policy enforcement.
- Recursive redaction before persistence.
- JSONL evidence recording and run lifecycle coordination.

LLM discovery, capability compilation, deterministic replay, and the operator handoff UI are
not implemented yet. Their final CLI commands and end-to-end demo path will be added with those
phases.

## Setup

Requirements:

- Node.js 24.x
- npm
- Playwright Chromium

```sh
npm ci
npx playwright install chromium
```

No API key or external service is required for the current Phase 1 implementation.

## Run

Start the fictional banking application:

```sh
npm run dev
```

Open:

```text
http://127.0.0.1:3000/member-search
```

Run the bounded local smoke check:

```sh
npm run smoke
```

Expected output:

```json
{
  "status": "ok",
  "check": "demo-http-surface",
  "httpStatus": 200,
  "title": "Member Search",
  "readyMarker": true
}
```

## Demo scenarios

| Scenario           | URL                                         |
| ------------------ | ------------------------------------------- |
| Normal             | `/member-search?scenario=normal`            |
| Slow load          | `/member-search?scenario=slow`              |
| Permission denied  | `/member-search?scenario=permission-denied` |
| Session expired    | `/member-search?scenario=session-expired`   |
| Known interstitial | `/member-search?scenario=dialog`            |
| Application error  | `/member-search?scenario=app-error`         |
| Invalid input      | `/member-search?scenario=invalid`           |

Normal example:

```text
Alex Morgan â†’ Member Details â†’ Accounts â†’ Savings â†’ $12,840.50
```

All members and financial values are fictional. The demo does not perform real banking
transactions.

## Verify

```sh
npm run format
npm run typecheck
npm run lint
npm run format:check
npm run smoke
npm run test:unit
npm run test:integration
npm run build
```

Current baseline:

- 76 unit tests passing.
- 33 Chromium integration tests passing.

To run integration tests in a visible browser on Windows PowerShell:

```powershell
$env:HEADED = '1'
npm run test:integration
Remove-Item Env:HEADED
```

## Safety boundaries

- Policy evaluation is deterministic and fail-closed.
- Target cardinality is always exactly one; ambiguity never selects the first match.
- Mutating browser operations are bounded and invalidate the surface if interrupted.
- Sensitive JSON values are sanitized in memory before persistence.
- Screenshots must be synthetic or masked before capture.
- Playwright trace attachment is restricted to synthetic fixtures.
- Runtime output under `evidence/` and `artifacts/` is ignored by Git by default.

See [REPORT.md](./REPORT.md) for architecture decisions, trade-offs, and deliberate cuts.
