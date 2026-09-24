# Human Handoff Evidence

This directory is a frozen reviewer package for one human-in-the-loop handoff against the local synthetic banking demo.

## Correlation

- Run ID: `hitl-demo-e118c9af-a6e5-4898-b5b8-ab25a5b6647a`
- Session ID: `35fdd9ca-c7c2-46ae-a863-fa266ac7c815`
- Intervention ID: `hitl-7a06d4e7-11c5-43ae-b65b-e9c9ea87534c`
- Source: `REPLAY`
- Capability: `prepare_new_savings_subaccount`
- Automation step: `confirm-create`

The handoff evidence events were validated to use this same run ID, session ID, and intervention ID.

## Escalation

Automation escalated with reason code `HUMAN_APPROVAL_REQUIRED`.

Recorded reason: Confirm Create Sub-Account is irreversible and requires a human operator.

Recorded state at escalation: Synthetic sub-account review screen is open with the final confirmation button visible.

Automation stopped at the recorded step rather than continuing through the intervention condition automatically.

## Live-session handoff

The existing session was preserved across the handoff.

HUMAN acquired control at `2026-09-24T03:05:57.841Z`.

No new run or replacement session is represented in this frozen package.

## Manual resolution

At `2026-09-24T03:08:29.161Z`, the audit trail recorded the following manual resolution:

Human completed final synthetic sub-account action

The evidence package records semantic human actions only. It does not persist raw mouse coordinates, keystrokes, cookies, tokens, credentials, BrowserContext objects, or Page handles.

## Resume

Automation control was restored at `2026-09-24T03:08:59.022Z`.

The persisted terminal run status is `success`.

## Screenshot evidence

- `screenshots/screenshot-0001.png` — state immediately before automation paused
- `screenshots/screenshot-0002.png` — same paused session after HUMAN acquired control
- `screenshots/screenshot-0003.png` — state after the recorded manual resolution
- `screenshots/screenshot-0004.png` — same session after automation control was restored

Only the four handoff checkpoints are copied into this reviewer package.

## Files

- `run.json` — sanitized source-run metadata
- `intervention.json` — sanitized persisted intervention, human actions, and audit trail
- `events.jsonl` — sanitized structured event log from the same logical run
- `result.json` — sanitized terminal result from the same logical run
- `screenshots/` — the four correlated handoff screenshots
- `SHA256SUMS.txt` — SHA-256 integrity hashes for every frozen file

## Integrity

`SHA256SUMS.txt` can be used to verify that the frozen reviewer files have not changed after packaging.
