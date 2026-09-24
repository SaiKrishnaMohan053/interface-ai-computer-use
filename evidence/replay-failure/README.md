# Frozen Replay Evidence



This directory is reviewer-safe evidence from a real Playwright replay against the local synthetic banking demo.



## Scenario



Real deterministic replay with the demo application-error scenario. Replay stops with APPLICATION_ERROR and preserves richer failure evidence including a screenshot.



## Capability



- ID: `lookup_savings_balance`

- Version: `1.0.1`

- Replay mode: deterministic

- LLM decisions during replay: none

- Invocation input values are intentionally omitted from replay evidence; validated input names are recorded without persisting sensitive values.



## Expected terminal result



failure with code APPLICATION_ERROR and screenshot evidence



## Files



- `run.json` â€” sanitized run metadata

- `events.jsonl` â€” sanitized structured event log

- `result.json` â€” sanitized terminal result

- `screenshots/` â€” synthetic-fixture failure screenshot
- `SHA256SUMS.txt` â€” integrity hashes for this evidence package



Temporary traces and unrelated runtime artifacts are intentionally excluded.
