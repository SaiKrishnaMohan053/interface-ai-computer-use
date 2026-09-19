import { readFile } from 'node:fs/promises';

import { join } from 'node:path';

import type { DiscoveryArtifactSource } from '../../src/artifact/index.js';

import {
  parseDiscoveryRequest,
  parseDiscoveryRunResult,
  parseDiscoveryTraceRecord,
  type DiscoveryExtractionRecord,
  type DiscoveryTraceRecord,
} from '../../src/discovery/index.js';

export const FROZEN_RUN_ID = '9635c0c9-dc3a-4b64-aa38-b1f48a359ea0';

export const FROZEN_INPUT = 'Alex Morgan';

export const FROZEN_OUTPUT = '$12,840.50';

export const FROZEN_ENTRY_URL = 'http://127.0.0.1:49349/member-search';

const evidenceDirectory = join(process.cwd(), 'evidence', 'discovery-success');

interface FrozenRunEnvelope {
  readonly runId: string;

  readonly mode: string;

  readonly startedAt: string;

  readonly metadata: {
    readonly policyId: string;

    readonly value: {
      readonly application: string;

      readonly goal: string;

      readonly maxSteps: number;
    };
  };
}

interface FrozenResultEnvelope {
  readonly runId: string;

  readonly mode: string;

  readonly status: string;

  readonly startedAt: string;

  readonly finishedAt: string;

  readonly durationMs: number;

  readonly result: {
    readonly outputs: Record<string, unknown>;
  };

  readonly evidenceRefs: readonly unknown[];
}

interface FrozenEvent {
  readonly timestamp: string;

  readonly runId: string;

  readonly mode: string;

  readonly step: number;

  readonly eventType: string;

  readonly action: {
    readonly kind?: string;

    readonly destination?: string;

    readonly saveAs?: string;
  } | null;

  readonly result: Record<string, unknown> | null;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function readEvents(): Promise<readonly FrozenEvent[]> {
  const contents = await readFile(join(evidenceDirectory, 'events.jsonl'), 'utf8');

  return contents
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as FrozenEvent);
}

function requiredString(value: unknown, description: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Frozen evidence is missing ${description}`);
  }

  return value;
}

function findSessionId(events: readonly FrozenEvent[]): string {
  for (const event of events) {
    if (event.eventType !== 'session_lifecycle' || event.result === null) {
      continue;
    }

    const sessionId = event.result.sessionId;

    if (typeof sessionId === 'string' && sessionId.length > 0) {
      return sessionId;
    }
  }

  throw new Error('Frozen evidence has no session lifecycle sessionId');
}

function findEntryUrl(events: readonly FrozenEvent[]): string {
  for (const event of events) {
    if (event.action?.kind === 'navigate' && typeof event.action.destination === 'string') {
      return event.action.destination;
    }
  }

  throw new Error('Frozen evidence has no initial navigation URL');
}

function extractDiscoveryTrace(events: readonly FrozenEvent[]): readonly DiscoveryTraceRecord[] {
  return events
    .filter((event) => event.eventType === 'discovery_trace')
    .map((event) => parseDiscoveryTraceRecord(event.result));
}

function findReadExtraction(
  events: readonly FrozenEvent[],
  trace: readonly DiscoveryTraceRecord[],
): DiscoveryExtractionRecord {
  const readDecision = trace.find(
    (
      record,
    ): record is Extract<
      DiscoveryTraceRecord,
      {
        readonly kind: 'model_decision';
      }
    > => record.kind === 'model_decision' && record.decision.kind === 'read',
  );

  if (readDecision === undefined || readDecision.decision.kind !== 'read') {
    throw new Error('Frozen discovery trace has no read decision');
  }

  const readResult = trace.find(
    (
      record,
    ): record is Extract<
      DiscoveryTraceRecord,
      {
        readonly kind: 'action_result';
      }
    > =>
      record.kind === 'action_result' &&
      record.step === readDecision.step &&
      record.actionKind === 'read' &&
      record.status === 'success',
  );

  if (readResult === undefined) {
    throw new Error('Frozen discovery trace has no successful read result');
  }

  const observation = trace.find(
    (
      record,
    ): record is Extract<
      DiscoveryTraceRecord,
      {
        readonly kind: 'observation';
      }
    > => record.kind === 'observation' && record.step === readDecision.step,
  );

  if (observation === undefined) {
    throw new Error('Frozen discovery trace has no read-step observation');
  }

  const actionEvent = events.find(
    (event) =>
      event.eventType === 'action' &&
      event.step === readDecision.step &&
      event.action?.kind === 'read' &&
      event.result !== null,
  );

  if (actionEvent === undefined || actionEvent.result === null) {
    throw new Error('Frozen evidence has no successful read action event');
  }

  const actionId = requiredString(actionEvent.result.actionId, 'read actionId');

  const value = readResult.extractedValues[readDecision.decision.saveAs];

  if (value === undefined) {
    throw new Error(`Frozen read result has no extracted value "${readDecision.decision.saveAs}"`);
  }

  return {
    outputName: readDecision.decision.saveAs,

    value,

    source: 'surface_read',

    step: readDecision.step,

    observationId: observation.observationId,

    actionId,
  };
}

export async function loadFrozenSource(): Promise<DiscoveryArtifactSource> {
  const [run, resultEnvelope, events] = await Promise.all([
    readJson<FrozenRunEnvelope>(join(evidenceDirectory, 'run.json')),

    readJson<FrozenResultEnvelope>(join(evidenceDirectory, 'result.json')),

    readEvents(),
  ]);

  if (run.runId !== FROZEN_RUN_ID || resultEnvelope.runId !== FROZEN_RUN_ID) {
    throw new Error('Frozen evidence run ID changed');
  }

  const trace = extractDiscoveryTrace(events);

  const entryUrl = findEntryUrl(events);

  const request = parseDiscoveryRequest({
    goal: run.metadata.value.goal,

    target: {
      entryUrl,

      application: run.metadata.value.application,
    },

    parameters: {
      memberName: FROZEN_INPUT,
    },

    limits: {
      maxSteps: run.metadata.value.maxSteps,
    },
  });

  const highestStep = trace.reduce((highest, record) => Math.max(highest, record.step), 0);

  const result = parseDiscoveryRunResult({
    runId: resultEnvelope.runId,

    sessionId: findSessionId(events),

    startedAt: resultEnvelope.startedAt,

    finishedAt: resultEnvelope.finishedAt,

    durationMs: resultEnvelope.durationMs,

    evidenceRefs: resultEnvelope.evidenceRefs,

    recoverableConditions: [],

    status: 'success',

    outputs: resultEnvelope.result.outputs,

    steps: highestStep,
  });

  const extraction = findReadExtraction(events, trace);

  return {
    runId: run.runId,

    request,

    result,

    trace,

    extractions: [extraction],
  };
}
