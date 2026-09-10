import {
  appendFile,
  mkdir,
  writeFile,
} from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  sanitizeForPersistence,
  serializeSanitizedLine,
} from '../security/index.js';
import type {
  EvidenceReference,
  Timestamp,
} from '../surface/contracts.js';

export type EvidenceRunMode =
  | 'DISCOVERY'
  | 'REPLAY'
  | 'HUMAN';

export type EvidenceEventType =
  | 'run_started'
  | 'session_lifecycle'
  | 'observation'
  | 'policy_decision'
  | 'action'
  | 'condition'
  | 'recoverable_condition'
  | 'intervention'
  | 'human_action'
  | 'evidence_captured'
  | 'run_finished';

export type EvidenceRunStatus =
  | 'success'
  | 'business_outcome'
  | 'intervention_required'
  | 'failure';

export interface StartRunOptions {
  readonly runId: string;
  readonly mode: EvidenceRunMode;
  readonly evidenceRoot?: string;
  readonly startedAt?: Timestamp;
  readonly metadata?: unknown;
}

export interface RecordEventInput {
  readonly timestamp?: Timestamp;
  readonly step: number;
  readonly eventType: EvidenceEventType;
  readonly action?: unknown;
  readonly target?: unknown;
  readonly policyDecision?: unknown;
  readonly result?: unknown;
  readonly evidenceRefs?: readonly EvidenceReference[];
}

export interface CaptureScreenshotInput {
  readonly step: number;
  readonly bytes: Uint8Array;
  readonly capturedAt?: Timestamp;
  readonly dataHandling:
    | 'REDACTED_BEFORE_CAPTURE'
    | 'SYNTHETIC_FIXTURE_ONLY';
}

export interface AttachTraceInput {
  readonly step: number;
  readonly bytes: Uint8Array;
  readonly capturedAt?: Timestamp;
  readonly dataHandling: 'SYNTHETIC_FIXTURE_ONLY';
}

export interface FinishRunInput {
  readonly status: EvidenceRunStatus;
  readonly result: unknown;
  readonly finishedAt?: Timestamp;
}

export interface RunEvidenceSummary {
  readonly runId: string;
  readonly mode: EvidenceRunMode;
  readonly status: EvidenceRunStatus;
  readonly startedAt: Timestamp;
  readonly finishedAt: Timestamp;
  readonly durationMs: number;
  readonly evidenceRefs: readonly EvidenceReference[];
}

interface PersistedEvent {
  readonly timestamp: Timestamp;
  readonly runId: string;
  readonly mode: EvidenceRunMode;
  readonly step: number;
  readonly eventType: EvidenceEventType;
  readonly action: unknown;
  readonly target: unknown;
  readonly policyDecision: unknown;
  readonly result: unknown;
  readonly evidenceRefs: readonly EvidenceReference[];
}

const pngSignature = [
  137,
  80,
  78,
  71,
  13,
  10,
  26,
  10,
] as const;

function normalizeTimestamp(
  value: Timestamp | undefined,
): Timestamp {
  const date =
    value === undefined
      ? new Date()
      : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid evidence timestamp');
  }

  return date.toISOString();
}

function validateRunId(runId: string): void {
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(
      runId,
    )
  ) {
    throw new Error('Invalid evidence runId');
  }
}

function validateStep(step: number): void {
  if (!Number.isInteger(step) || step < 0) {
    throw new Error(
      'Evidence step must be non-negative',
    );
  }
}

function validatePng(bytes: Uint8Array): void {
  if (
    bytes.length < pngSignature.length ||
    pngSignature.some(
      (byte, index) => bytes[index] !== byte,
    )
  ) {
    throw new Error(
      'Screenshot evidence must contain PNG bytes',
    );
  }
}

function validateTrace(bytes: Uint8Array): void {
  if (
    bytes.length < 2 ||
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b
  ) {
    throw new Error(
      'Trace evidence must contain ZIP bytes',
    );
  }
}

function serializeEvent(
  event: PersistedEvent,
): string {
  return serializeSanitizedLine(
    sanitizeForPersistence(event),
  );
}

export class EvidenceRecorder {
  readonly runId: string;
  readonly mode: EvidenceRunMode;
  readonly startedAt: Timestamp;
  readonly runDirectory: string;
  readonly eventLogReference: EvidenceReference;

  private readonly eventsPath: string;
  private readonly references: EvidenceReference[];

  private writeQueue: Promise<void> =
    Promise.resolve();

  private state:
    | 'ACTIVE'
    | 'FINISHING'
    | 'FINISHED' = 'ACTIVE';

  private screenshotSequence = 0;
  private traceSequence = 0;

  private constructor(options: {
    runId: string;
    mode: EvidenceRunMode;
    startedAt: Timestamp;
    runDirectory: string;
    eventsPath: string;
    eventLogReference: EvidenceReference;
  }) {
    this.runId = options.runId;
    this.mode = options.mode;
    this.startedAt = options.startedAt;
    this.runDirectory = options.runDirectory;
    this.eventsPath = options.eventsPath;
    this.eventLogReference =
      options.eventLogReference;
    this.references = [
      options.eventLogReference,
    ];
  }

  static async startRun(
    options: StartRunOptions,
  ): Promise<EvidenceRecorder> {
    validateRunId(options.runId);

    const startedAt = normalizeTimestamp(
      options.startedAt,
    );

    const evidenceRoot = resolve(
      options.evidenceRoot ?? 'evidence',
    );

    const runDirectory = resolve(
      evidenceRoot,
      options.runId,
    );

    const eventsPath = resolve(
      runDirectory,
      'events.jsonl',
    );

    await mkdir(evidenceRoot, {
      recursive: true,
    });

    /*
     * recursive:false prevents accidentally reusing
     * and overwriting an existing run.
     */
    await mkdir(runDirectory);

    await Promise.all([
      mkdir(
        resolve(
          runDirectory,
          'screenshots',
        ),
      ),
      mkdir(
        resolve(runDirectory, 'traces'),
      ),
    ]);

    const eventLogReference: EvidenceReference = {
      evidenceId: randomUUID(),
      runId: options.runId,
      kind: 'event_log',
      relativePath: `${options.runId}/events.jsonl`,
      mediaType: 'application/x-ndjson',
      capturedAt: startedAt,
    };

    const recorder = new EvidenceRecorder({
      runId: options.runId,
      mode: options.mode,
      startedAt,
      runDirectory,
      eventsPath,
      eventLogReference,
    });

    const startEvent = recorder.buildEvent({
      timestamp: startedAt,
      step: 0,
      eventType: 'run_started',
      result: options.metadata ?? null,
      evidenceRefs: [
        eventLogReference,
      ],
    });

    await writeFile(
      eventsPath,
      serializeEvent(startEvent),
      {
        encoding: 'utf8',
        flag: 'wx',
      },
    );

    return recorder;
  }

  recordEvent(
    input: RecordEventInput,
  ): Promise<void> {
    this.assertActive();
    validateStep(input.step);

    const event =
      this.buildEvent(input);

    return this.enqueue(() =>
      this.appendEvent(event),
    );
  }

  captureScreenshot(
    input: CaptureScreenshotInput,
  ): Promise<EvidenceReference> {
    this.assertActive();
    validateStep(input.step);
    validatePng(input.bytes);

    if (
      input.dataHandling !==
        'REDACTED_BEFORE_CAPTURE' &&
      input.dataHandling !==
        'SYNTHETIC_FIXTURE_ONLY'
    ) {
      throw new Error(
        'Raw screenshot evidence cannot be persisted',
      );
    }

    const capturedAt = normalizeTimestamp(
      input.capturedAt,
    );

    const sequence =
      ++this.screenshotSequence;

    const fileName =
      `screenshot-${sequence
        .toString()
        .padStart(4, '0')}.png`;

    const reference: EvidenceReference = {
      evidenceId: randomUUID(),
      runId: this.runId,
      kind: 'screenshot',
      relativePath:
        `${this.runId}/screenshots/${fileName}`,
      mediaType: 'image/png',
      capturedAt,
    };

    /*
     * Copy the bytes before asynchronous persistence so
     * the caller cannot mutate the underlying buffer.
     */
    const bytes =
      Uint8Array.from(input.bytes);

    return this.enqueue(async () => {
      await writeFile(
        resolve(
          this.runDirectory,
          'screenshots',
          fileName,
        ),
        bytes,
        {
          flag: 'wx',
        },
      );

      this.references.push(reference);

      await this.appendEvent(
        this.buildEvent({
          timestamp: capturedAt,
          step: input.step,
          eventType:
            'evidence_captured',
          result: {
            kind: 'screenshot',
            dataHandling:
              input.dataHandling,
          },
          evidenceRefs: [reference],
        }),
      );

      return reference;
    });
  }

  attachTrace(
    input: AttachTraceInput,
  ): Promise<EvidenceReference> {
    this.assertActive();
    validateStep(input.step);
    validateTrace(input.bytes);

    if (
      input.dataHandling !==
      'SYNTHETIC_FIXTURE_ONLY'
    ) {
      throw new Error(
        'Playwright traces are restricted to synthetic fixtures',
      );
    }

    const capturedAt = normalizeTimestamp(
      input.capturedAt,
    );

    const sequence =
      ++this.traceSequence;

    const fileName =
      `trace-${sequence
        .toString()
        .padStart(4, '0')}.zip`;

    const reference: EvidenceReference = {
      evidenceId: randomUUID(),
      runId: this.runId,
      kind: 'trace',
      relativePath:
        `${this.runId}/traces/${fileName}`,
      mediaType: 'application/zip',
      capturedAt,
    };

    const bytes =
      Uint8Array.from(input.bytes);

    return this.enqueue(async () => {
      await writeFile(
        resolve(
          this.runDirectory,
          'traces',
          fileName,
        ),
        bytes,
        {
          flag: 'wx',
        },
      );

      this.references.push(reference);

      await this.appendEvent(
        this.buildEvent({
          timestamp: capturedAt,
          step: input.step,
          eventType:
            'evidence_captured',
          result: {
            kind: 'trace',
            dataHandling:
              input.dataHandling,
          },
          evidenceRefs: [reference],
        }),
      );

      return reference;
    });
  }

  async finishRun(
    input: FinishRunInput,
  ): Promise<RunEvidenceSummary> {
    this.assertActive();
    this.state = 'FINISHING';

    const finishedAt = normalizeTimestamp(
      input.finishedAt,
    );

    const finishedTime =
      Date.parse(finishedAt);

    const startedTime =
      Date.parse(this.startedAt);

    if (finishedTime < startedTime) {
      this.state = 'ACTIVE';

      throw new Error(
        'finishedAt cannot be earlier than startedAt',
      );
    }

    try {
      await this.enqueue(() =>
        this.appendEvent(
          this.buildEvent({
            timestamp: finishedAt,
            step: 0,
            eventType: 'run_finished',
            result: {
              status: input.status,
              value: input.result,
            },
            evidenceRefs: [
              ...this.references,
            ],
          }),
        ),
      );

      this.state = 'FINISHED';

      return Object.freeze({
        runId: this.runId,
        mode: this.mode,
        status: input.status,
        startedAt: this.startedAt,
        finishedAt,
        durationMs:
          finishedTime - startedTime,
        evidenceRefs: Object.freeze([
          ...this.references,
        ]),
      });
    } catch (error) {
      this.state = 'ACTIVE';
      throw error;
    }
  }

  private buildEvent(
    input: RecordEventInput,
  ): PersistedEvent {
    return {
      timestamp: normalizeTimestamp(
        input.timestamp,
      ),
      runId: this.runId,
      mode: this.mode,
      step: input.step,
      eventType: input.eventType,
      action: input.action ?? null,
      target: input.target ?? null,
      policyDecision:
        input.policyDecision ?? null,
      result: input.result ?? null,
      evidenceRefs:
        input.evidenceRefs ?? [],
    };
  }

  private appendEvent(
    event: PersistedEvent,
  ): Promise<void> {
    /*
     * serializeEvent() performs recursive redaction
     * before appendFile receives any data.
     */
    const line = serializeEvent(event);

    return appendFile(
      this.eventsPath,
      line,
      {
        encoding: 'utf8',
      },
    );
  }

  private enqueue<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    const result = this.writeQueue.then(
      operation,
      operation,
    );

    this.writeQueue = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }

  private assertActive(): void {
    if (this.state !== 'ACTIVE') {
      throw new Error(
        `Evidence run is ${this.state.toLowerCase()}`,
      );
    }
  }
}

export function startRun(
  options: StartRunOptions,
): Promise<EvidenceRecorder> {
  return EvidenceRecorder.startRun(options);
}