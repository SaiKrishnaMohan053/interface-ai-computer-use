# Frozen Replay Evidence



This directory is reviewer-safe evidence from a real Playwright replay against the local synthetic banking demo.



## Scenario



Real deterministic replay with the demo known-interstitial scenario. The artifact-authorized interstitial recovery is bounded, deterministic, and replay continues to success.



## Capability



- ID: `lookup_savings_balance`

- Version: `1.0.1`

- Replay mode: deterministic

- LLM decisions during replay: none

- Invocation input values are intentionally omitted from replay evidence; validated input names are recorded without persisting sensitive values.



## Expected terminal result



known interstitial recovered, followed by success



## Files



- `run.json` â€” sanitized run metadata

- `events.jsonl` â€” sanitized structured event log

- `result.json` â€” sanitized terminal result

- `SHA256SUMS.txt` â€” integrity hashes for this evidence package



Temporary traces and unrelated runtime artifacts are intentionally excluded.
