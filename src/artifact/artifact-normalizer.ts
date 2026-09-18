import { targetSpecSchema, type TargetSpec, type TargetStrategy } from '../targeting/index.js';

import { ArtifactError } from './artifact-errors.js';

import type { DiscoveryTraceRecord } from '../discovery/index.js';

import type { RiskLevel } from '../policy/index.js';

type TargetTextMatch = Extract<TargetStrategy, { readonly kind: 'role-name' }>['name'];

type StructuralStrategy = Extract<TargetStrategy, { readonly kind: 'structural' }>;

type DiscoveryRiskLevel = Extract<
  DiscoveryTraceRecord,
  { readonly kind: 'policy_decision' }
>['systemRiskLevel'];

export interface NormalizedDiscoveryAction {
  readonly sourceStep: number;
  readonly decision: Extract<DiscoveryTraceRecord, { readonly kind: 'model_decision' }>['decision'];
  readonly risk: DiscoveryRiskLevel;
}

function normalizeDescription(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeLocatorText(value: string): string {
  return value.trim();
}

function normalizeTextMatch(match: TargetTextMatch): TargetTextMatch {
  return {
    value: normalizeLocatorText(match.value),
    mode: match.mode,
    caseSensitive: match.caseSensitive,
  };
}

function normalizeStructuralQuery(query: StructuralStrategy['query']): StructuralStrategy['query'] {
  switch (query.kind) {
    case 'table-cell':
      return {
        kind: 'table-cell',
        table: {
          name: normalizeTextMatch(query.table.name),
        },
        row: {
          columnHeader: normalizeTextMatch(query.row.columnHeader),
          value: normalizeTextMatch(query.row.value),
        },
        column: {
          header: normalizeTextMatch(query.column.header),
        },
      };

    case 'within':
      return {
        kind: 'within',
        container: {
          ...(query.container.role === undefined
            ? {}
            : {
                role: normalizeLocatorText(query.container.role),
              }),
          ...(query.container.name === undefined
            ? {}
            : {
                name: normalizeTextMatch(query.container.name),
              }),
          ...(query.container.text === undefined
            ? {}
            : {
                text: normalizeTextMatch(query.container.text),
              }),
        },
        target: {
          ...(query.target.role === undefined
            ? {}
            : {
                role: normalizeLocatorText(query.target.role),
              }),
          ...(query.target.name === undefined
            ? {}
            : {
                name: normalizeTextMatch(query.target.name),
              }),
          ...(query.target.text === undefined
            ? {}
            : {
                text: normalizeTextMatch(query.target.text),
              }),
          ...(query.target.zeroBasedIndex === undefined
            ? {}
            : {
                zeroBasedIndex: query.target.zeroBasedIndex,
              }),
        },
      };
  }
}

function normalizeTargetStrategy(strategy: TargetStrategy): TargetStrategy {
  switch (strategy.kind) {
    case 'role-name':
      return {
        kind: 'role-name',
        role: normalizeLocatorText(strategy.role),
        name: normalizeTextMatch(strategy.name),
      };

    case 'label':
      return {
        kind: 'label',
        label: normalizeTextMatch(strategy.label),
      };

    case 'text':
      return {
        kind: 'text',
        text: normalizeTextMatch(strategy.text),
      };

    case 'structural':
      return {
        kind: 'structural',
        query: normalizeStructuralQuery(strategy.query),
      };

    case 'css':
      return {
        kind: 'css',
        selector: strategy.selector.trim(),
      };

    case 'xpath':
      return {
        kind: 'xpath',
        expression: strategy.expression.trim(),
      };
  }
}

function targetStrategyKey(strategy: TargetStrategy): string {
  return JSON.stringify(strategy);
}

function removeDuplicateTargetStrategies(strategies: readonly TargetStrategy[]): TargetStrategy[] {
  const seen = new Set<string>();
  const normalized: TargetStrategy[] = [];

  for (const strategy of strategies) {
    const key = targetStrategyKey(strategy);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(strategy);
  }

  return normalized;
}

/**
 * Deterministically cleans a persisted TargetSpec.
 *
 * Rules:
 * - validate the source TargetSpec;
 * - normalize only safe whitespace;
 * - preserve strategy ordering;
 * - remove exact duplicates after normalization;
 * - never invent locator strategies;
 * - never resolve a target or persist runtime handles;
 * - preserve semantic and explicitly supplied brittle fallbacks.
 */
export function normalizeArtifactTargetSpec(value: unknown): TargetSpec {
  let source: TargetSpec;

  try {
    source = targetSpecSchema.parse(value);
  } catch (error) {
    throw new ArtifactError('ARTIFACT_SOURCE_INVALID', 'Artifact target specification is invalid', {
      cause: error,
    });
  }

  const strategies = removeDuplicateTargetStrategies(
    source.strategies.map(normalizeTargetStrategy),
  );

  if (strategies.length === 0) {
    throw new ArtifactError(
      'ARTIFACT_SOURCE_INVALID',
      'Artifact target must contain at least one strategy',
    );
  }

  return targetSpecSchema.parse({
    description: normalizeDescription(source.description),
    strategies,
    cardinality: source.cardinality,
  });
}

export interface NormalizedDiscoveryAction {
  readonly sourceStep: number;

  readonly decision: Extract<DiscoveryTraceRecord, { readonly kind: 'model_decision' }>['decision'];

  readonly risk: RiskLevel;
}

export interface SuccessfulPathExtractionResult {
  readonly actions: readonly NormalizedDiscoveryAction[];

  readonly discarded: readonly SuccessfulPathDiscardRecord[];
}

export type SuccessfulPathDiscardReason =
  | 'OBSERVATION'
  | 'MODEL_CONTROL_DECISION'
  | 'POLICY_LOG'
  | 'TARGET_RESOLUTION_LOG'
  | 'FAILED_ACTION'
  | 'CONDITION_LOG'
  | 'RUNTIME_EVENT'
  | 'DUPLICATE_NON_CONTRIBUTING_ACTION';

export interface SuccessfulPathDiscardRecord {
  readonly step: number;
  readonly kind: DiscoveryTraceRecord['kind'];
  readonly reason: SuccessfulPathDiscardReason;
}

function recordsForDiscoveryStep(
  trace: readonly DiscoveryTraceRecord[],
  step: number,
): readonly DiscoveryTraceRecord[] {
  return trace.filter((record) => record.step === step);
}

function isControlDecision(
  record: Extract<DiscoveryTraceRecord, { readonly kind: 'model_decision' }>,
): boolean {
  return record.decision.kind === 'complete' || record.decision.kind === 'escalate';
}

export function extractSuccessfulDiscoveryPath(
  trace: readonly DiscoveryTraceRecord[],
): SuccessfulPathExtractionResult {
  const actions: NormalizedDiscoveryAction[] = [];
  const discarded: SuccessfulPathDiscardRecord[] = [];

  const seenSuccessfulSteps = new Set<number>();

  for (const record of trace) {
    switch (record.kind) {
      case 'observation':
        discarded.push({
          step: record.step,
          kind: record.kind,
          reason: 'OBSERVATION',
        });
        continue;

      case 'policy_decision':
        discarded.push({
          step: record.step,
          kind: record.kind,
          reason: 'POLICY_LOG',
        });
        continue;

      case 'target_resolution':
        discarded.push({
          step: record.step,
          kind: record.kind,
          reason: 'TARGET_RESOLUTION_LOG',
        });
        continue;

      case 'condition_result':
        discarded.push({
          step: record.step,
          kind: record.kind,
          reason: 'CONDITION_LOG',
        });
        continue;

      case 'runtime_event':
        discarded.push({
          step: record.step,
          kind: record.kind,
          reason: 'RUNTIME_EVENT',
        });
        continue;

      case 'action_result':
        if (record.status !== 'success') {
          discarded.push({
            step: record.step,
            kind: record.kind,
            reason: 'FAILED_ACTION',
          });
        }

        continue;

      case 'model_decision':
        if (isControlDecision(record)) {
          discarded.push({
            step: record.step,
            kind: record.kind,
            reason: 'MODEL_CONTROL_DECISION',
          });
          continue;
        }

        break;
    }

    const records = recordsForDiscoveryStep(trace, record.step);

    const matchingActionResult = records.find(
      (candidate): candidate is Extract<DiscoveryTraceRecord, { readonly kind: 'action_result' }> =>
        candidate.kind === 'action_result' && candidate.actionKind === record.decision.kind,
    );

    if (matchingActionResult === undefined || matchingActionResult.status !== 'success') {
      discarded.push({
        step: record.step,
        kind: record.kind,
        reason: 'FAILED_ACTION',
      });

      continue;
    }

    const matchingPolicy = records.find(
      (
        candidate,
      ): candidate is Extract<DiscoveryTraceRecord, { readonly kind: 'policy_decision' }> =>
        candidate.kind === 'policy_decision' && candidate.actionKind === record.decision.kind,
    );

    if (matchingPolicy === undefined || matchingPolicy.policyDecision.decision !== 'ALLOW') {
      continue;
    }

    if (seenSuccessfulSteps.has(record.step)) {
      discarded.push({
        step: record.step,
        kind: record.kind,
        reason: 'DUPLICATE_NON_CONTRIBUTING_ACTION',
      });

      continue;
    }

    seenSuccessfulSteps.add(record.step);

    actions.push({
      sourceStep: record.step,
      decision: record.decision,
      risk: matchingPolicy.systemRiskLevel,
    });
  }

  actions.sort((left, right) => left.sourceStep - right.sourceStep);

  return {
    actions,
    discarded,
  };
}
