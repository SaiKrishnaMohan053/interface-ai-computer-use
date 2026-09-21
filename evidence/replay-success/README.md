# Frozen Replay Evidence

This directory is reviewer-safe evidence from a real Playwright replay against the local synthetic banking demo.

## Scenario

Real deterministic replay of lookup_savings_balance with a valid member. The replay completes successfully and returns the declared savingsBalance output.

## Capability

- ID: `lookup_savings_balance`
- Version: `1.0.0`
- Replay mode: deterministic
- LLM decisions during replay: none

## Expected terminal result

success with savingsBalance = $12,840.50

## Files

- `run.json` — sanitized run metadata
- `events.jsonl` — sanitized structured event log
- `result.json` — sanitized terminal result
- `SHA256SUMS.txt` — integrity hashes for this evidence package

Temporary traces and unrelated runtime artifacts are intentionally excluded.
