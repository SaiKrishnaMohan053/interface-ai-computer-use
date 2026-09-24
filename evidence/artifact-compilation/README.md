# Artifact Compilation Evidence

This package documents deterministic compilation of the genuine successful Phase 2 discovery run into the reusable capability artifact `lookup_savings_balance` version `1.0.0`.

## Source

- Discovery run: `9635c0c9-dc3a-4b64-aa38-b1f48a359ea0`
- Source package: `evidence/discovery-success/`
- Raw discovery trace is intentionally not duplicated here.

The discovery trace and capability artifact are different contracts: the trace records one observed run, while the artifact contains only the reusable, parameterized workflow needed for deterministic replay.

Artifact compilation is LLM-free. The compiler consumes the validated frozen discovery result/trace and explicit compile configuration; it does not call OpenAI or any other model.

## Result

- Artifact: `artifacts/lookup_savings_balance/1.0.0.json`
- Schema validation: passed
- Semantic validation: passed
- Persistence safety: passed
- SHA-256: `1462d59102f9f0440e702e76343ba3d8ca9cdd1d4eeba01bb271fe915c22e40e`

## Files

- `compile-result.json`: concise compilation result
- `validation-result.json`: validation summary
- `artifact-reference.json`: final artifact identity, path, provenance, and hash
- `SHA256SUMS.txt`: integrity hashes for reviewer-facing outputs

This evidence package intentionally excludes raw model responses, decision rationale, browser/runtime handles, screenshots, observations, session state, and invocation-specific discovery values.
