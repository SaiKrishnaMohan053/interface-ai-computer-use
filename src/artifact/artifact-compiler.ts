/**
 * Deterministic Discovery Trace -> CapabilityArtifact compiler.
 *
 * The compiler will:
 * - accept only verified successful discovery sources,
 * - normalize successful reusable actions,
 * - apply explicit parameter/output bindings,
 * - attach compiler-supplied capability metadata,
 * - produce a validated CapabilityArtifact.
 *
 * The compiler must never invoke an LLM.
 */
export {};
