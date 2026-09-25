# Artifact Compilation Evidence

This package demonstrates deterministic compilation of the genuine successful discovery run into the reusable capability artifact `lookup_savings_balance` version `1.0.0`.

## Generation

Generated deterministically from the frozen successful discovery package in `evidence/discovery-success/` using the artifact compiler and explicit capability configuration. Compilation is LLM-free and does not call OpenAI or any other model.

## Expected result

- Capability: `lookup_savings_balance`
- Version: `1.0.0`
- Schema validation: passed
- Semantic validation: passed
- Persistence safety: passed
- Deterministic serialization: passed
- SHA-256: `1462d59102f9f0440e702e76343ba3d8ca9cdd1d4eeba01bb271fe915c22e40e`

The discovery trace and capability artifact are separate contracts: the trace records one observed run, while the artifact contains the reusable parameterized workflow required for deterministic replay.

## Important files

- `compile-result.json` — compilation result and artifact identity
- `validation-result.json` — schema, semantic, and persistence-safety checks
- `artifact-reference.json` — artifact path, provenance, and integrity reference
- `SHA256SUMS.txt` — expected SHA-256 hashes for the frozen package

The package intentionally excludes raw model responses, hidden reasoning, browser/runtime handles, session state, and invocation-specific values that do not belong in the reusable artifact.

## Integrity

`SHA256SUMS.txt` contains the expected SHA-256 hashes for the frozen files. Recompute the hashes locally and compare them with the manifest before relying on the package.
