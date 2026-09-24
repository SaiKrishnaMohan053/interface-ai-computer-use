import { createHash } from 'node:crypto';

import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';

import { basename, join, relative, resolve, sep } from 'node:path';

import { sanitizeForPersistence, serializeSanitized } from '../security/index.js';

import { storedInterventionSchema } from './intervention-store.js';

import type { StoredIntervention } from './intervention-store.js';

const HANDOFF_CHECKPOINTS = [
  'BEFORE_INTERVENTION',
  'HUMAN_CONTROL',
  'HUMAN_RESOLUTION',
  'AUTOMATION_RESUMED',
] as const;

type HandoffCheckpoint = (typeof HANDOFF_CHECKPOINTS)[number];

interface PersistedEventRecord {
  readonly runId: string;
  readonly eventType: string;
  readonly result: unknown;
  readonly evidenceRefs: readonly unknown[];
}

interface ScreenshotReference {
  readonly evidenceId: string;
  readonly runId: string;
  readonly kind: 'screenshot';
  readonly relativePath: string;
  readonly mediaType: string;
  readonly capturedAt: string;
}

interface HandoffEventResult {
  readonly kind: 'handoff_evidence';
  readonly sessionId: string;
  readonly interventionId: string;
  readonly source: 'DISCOVERY' | 'REPLAY';
  readonly checkpoint: HandoffCheckpoint;
  readonly sessionState: string;
  readonly sessionOwner: string;
  readonly screenshotCaptured: boolean;
}

interface HandoffEvent {
  readonly runId: string;
  readonly result: HandoffEventResult;
  readonly evidenceRefs: readonly ScreenshotReference[];
}

export interface FreezeHumanHandoffEvidenceInput {
  readonly sourceEvidenceRoot: string;

  readonly runId: string;

  readonly outputDirectory: string;

  readonly intervention: StoredIntervention;
}

export interface FrozenHumanHandoffEvidencePackage {
  readonly outputDirectory: string;

  readonly runId: string;

  readonly sessionId: string;

  readonly interventionId: string;

  readonly screenshots: readonly string[];
}

export async function freezeHumanHandoffEvidencePackage(
  input: FreezeHumanHandoffEvidenceInput,
): Promise<FrozenHumanHandoffEvidencePackage> {
  const intervention = storedInterventionSchema.parse(input.intervention);

  const runId = requireNonEmpty(input.runId, 'runId');

  const sourceEvidenceRoot = resolve(input.sourceEvidenceRoot);

  const sourceRunDirectory = resolve(sourceEvidenceRoot, runId);

  const outputDirectory = resolve(input.outputDirectory);

  assertWithinDirectory(
    sourceEvidenceRoot,
    sourceRunDirectory,
    `Unsafe source run directory for runId "${runId}"`,
  );

  if (sourceRunDirectory === outputDirectory) {
    throw new Error('Human handoff output directory must differ from the source run directory');
  }

  const runPath = join(sourceRunDirectory, 'run.json');

  const eventsPath = join(sourceRunDirectory, 'events.jsonl');

  const resultPath = join(sourceRunDirectory, 'result.json');

  const [runContents, eventsContents, resultContents] = await Promise.all([
    readFile(runPath, 'utf8'),

    readFile(eventsPath, 'utf8'),

    readFile(resultPath, 'utf8'),
  ]);

  const runJson = parseJsonObject(runContents, 'run.json');

  const resultJson = parseJsonObject(resultContents, 'result.json');

  const runJsonRunId = stringProperty(runJson, 'runId');

  if (runJsonRunId !== runId) {
    throw new Error(
      `run.json runId mismatch: expected "${runId}", received "${String(runJsonRunId)}"`,
    );
  }

  const resultJsonRunId = stringProperty(resultJson, 'runId');

  if (resultJsonRunId !== runId) {
    throw new Error(
      `result.json runId mismatch: expected "${runId}", received "${String(resultJsonRunId)}"`,
    );
  }

  const events = parseJsonLines(eventsContents);

  const handoffEvents = HANDOFF_CHECKPOINTS.map((checkpoint) =>
    requireHandoffEvent({
      events,

      checkpoint,

      runId,

      sessionId: intervention.request.sessionId,

      interventionId: intervention.request.id,
    }),
  );

  const screenshotReferences = handoffEvents.map((event) => {
    if (event.result.screenshotCaptured !== true) {
      throw new Error(
        `Handoff checkpoint ${event.result.checkpoint} does not contain screenshot evidence`,
      );
    }

    if (event.evidenceRefs.length !== 1) {
      throw new Error(
        `Handoff checkpoint ${event.result.checkpoint} must reference exactly one screenshot`,
      );
    }

    const reference = event.evidenceRefs[0];

    if (reference === undefined) {
      throw new Error(
        `Handoff checkpoint ${event.result.checkpoint} is missing its screenshot reference`,
      );
    }

    if (reference.runId !== runId) {
      throw new Error(`Handoff screenshot ${reference.evidenceId} belongs to another run`);
    }

    return reference;
  });

  const screenshotNames = screenshotReferences.map((reference) => basename(reference.relativePath));

  if (new Set(screenshotNames).size !== screenshotNames.length) {
    throw new Error('Handoff screenshot filenames must be unique');
  }

  await rm(outputDirectory, {
    recursive: true,

    force: true,
  });

  await mkdir(join(outputDirectory, 'screenshots'), {
    recursive: true,
  });

  await Promise.all([
    copyFile(runPath, join(outputDirectory, 'run.json')),

    copyFile(eventsPath, join(outputDirectory, 'events.jsonl')),

    copyFile(resultPath, join(outputDirectory, 'result.json')),
  ]);

  await writeFile(
    join(outputDirectory, 'intervention.json'),

    serializeSanitized(sanitizeForPersistence(intervention)),

    'utf8',
  );

  for (const reference of screenshotReferences) {
    const sourceScreenshot = resolve(sourceEvidenceRoot, reference.relativePath);

    assertWithinDirectory(
      sourceEvidenceRoot,
      sourceScreenshot,
      `Unsafe screenshot reference "${reference.relativePath}"`,
    );

    await copyFile(
      sourceScreenshot,

      join(outputDirectory, 'screenshots', basename(reference.relativePath)),
    );
  }

  await writeReviewerReadme({
    directory: outputDirectory,

    runId,

    intervention,

    terminalStatus: stringProperty(resultJson, 'status') ?? 'unknown',

    screenshotNames,
  });

  await writeChecksums(outputDirectory);

  return Object.freeze({
    outputDirectory,

    runId,

    sessionId: intervention.request.sessionId,

    interventionId: intervention.request.id,

    screenshots: Object.freeze([...screenshotNames]),
  });
}

function requireHandoffEvent(input: {
  readonly events: readonly unknown[];

  readonly checkpoint: HandoffCheckpoint;

  readonly runId: string;

  readonly sessionId: string;

  readonly interventionId: string;
}): HandoffEvent {
  const matches = input.events
    .map(parsePersistedEventRecord)
    .filter((event): event is PersistedEventRecord => event !== null)
    .filter((event) => {
      if (event.runId !== input.runId || event.eventType !== 'intervention') {
        return false;
      }

      if (!isRecord(event.result)) {
        return false;
      }

      return (
        event.result.kind === 'handoff_evidence' &&
        event.result.sessionId === input.sessionId &&
        event.result.interventionId === input.interventionId &&
        event.result.checkpoint === input.checkpoint
      );
    });

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${input.checkpoint} handoff event for intervention ${input.interventionId}; found ${matches.length}`,
    );
  }

  const event = matches[0];

  if (event === undefined) {
    throw new Error(`Missing ${input.checkpoint} handoff event`);
  }

  if (!isRecord(event.result)) {
    throw new Error(`Invalid ${input.checkpoint} handoff event result`);
  }

  const source =
    event.result.source === 'DISCOVERY'
      ? 'DISCOVERY'
      : event.result.source === 'REPLAY'
        ? 'REPLAY'
        : null;

  if (source === null) {
    throw new Error(`Invalid ${input.checkpoint} handoff source`);
  }

  const sessionState =
    typeof event.result.sessionState === 'string' ? event.result.sessionState : 'UNKNOWN';

  const sessionOwner =
    typeof event.result.sessionOwner === 'string' ? event.result.sessionOwner : 'UNKNOWN';

  return {
    runId: event.runId,

    result: {
      kind: 'handoff_evidence',

      sessionId: input.sessionId,

      interventionId: input.interventionId,

      source,

      checkpoint: input.checkpoint,

      sessionState,

      sessionOwner,

      screenshotCaptured: event.result.screenshotCaptured === true,
    },

    evidenceRefs: event.evidenceRefs.map(parseScreenshotReference),
  };
}

function parsePersistedEventRecord(value: unknown): PersistedEventRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.runId !== 'string' || typeof value.eventType !== 'string') {
    return null;
  }

  return {
    runId: value.runId,

    eventType: value.eventType,

    result: value.result,

    evidenceRefs: Array.isArray(value.evidenceRefs) ? value.evidenceRefs : [],
  };
}

function parseScreenshotReference(value: unknown): ScreenshotReference {
  if (!isRecord(value)) {
    throw new Error('Invalid handoff evidence reference');
  }

  if (
    value.kind !== 'screenshot' ||
    typeof value.evidenceId !== 'string' ||
    typeof value.runId !== 'string' ||
    typeof value.relativePath !== 'string' ||
    typeof value.mediaType !== 'string' ||
    typeof value.capturedAt !== 'string'
  ) {
    throw new Error('Invalid handoff screenshot evidence reference');
  }

  return {
    evidenceId: value.evidenceId,

    runId: value.runId,

    kind: 'screenshot',

    relativePath: value.relativePath,

    mediaType: value.mediaType,

    capturedAt: value.capturedAt,
  };
}

async function writeReviewerReadme(input: {
  readonly directory: string;

  readonly runId: string;

  readonly intervention: StoredIntervention;

  readonly terminalStatus: string;

  readonly screenshotNames: readonly string[];
}): Promise<void> {
  const request = input.intervention.request;

  const acquired = input.intervention.auditTrail.find(
    (event) => event.type === 'human.control_acquired',
  );

  const manual = input.intervention.auditTrail.find(
    (event) => event.type === 'human.action_performed',
  );

  const restored = input.intervention.auditTrail.find(
    (event) => event.type === 'automation.control_restored',
  );

  if (acquired === undefined) {
    throw new Error('Frozen handoff evidence requires human.control_acquired audit evidence');
  }

  if (manual === undefined) {
    throw new Error('Frozen handoff evidence requires human.action_performed audit evidence');
  }

  if (restored === undefined) {
    throw new Error('Frozen handoff evidence requires automation.control_restored audit evidence');
  }

  const descriptions: Record<HandoffCheckpoint, string> = {
    BEFORE_INTERVENTION: 'state immediately before automation paused',

    HUMAN_CONTROL: 'same paused session after HUMAN acquired control',

    HUMAN_RESOLUTION: 'state after the recorded manual resolution',

    AUTOMATION_RESUMED: 'same session after automation control was restored',
  };

  const screenshotLines = HANDOFF_CHECKPOINTS.map((checkpoint, index) => {
    const name = input.screenshotNames[index];

    if (name === undefined) {
      throw new Error(`Missing screenshot filename for ${checkpoint}`);
    }

    return `- \`screenshots/${name}\` — ${descriptions[checkpoint]}`;
  }).join('\n');

  const capability =
    request.capabilityId === undefined ? 'not recorded' : `\`${request.capabilityId}\``;

  const step = request.stepId === undefined ? 'not recorded' : `\`${request.stepId}\``;

  const markdown = `# Human Handoff Evidence

This directory is a frozen reviewer package for one human-in-the-loop handoff against the local synthetic banking demo.

## Correlation

- Run ID: \`${input.runId}\`
- Session ID: \`${request.sessionId}\`
- Intervention ID: \`${request.id}\`
- Source: \`${request.source}\`
- Capability: ${capability}
- Automation step: ${step}

The handoff evidence events were validated to use this same run ID, session ID, and intervention ID.

## Escalation

Automation escalated with reason code \`${request.reasonCode}\`.

Recorded reason: ${request.reason}

Recorded state at escalation: ${request.observedState}

Automation stopped at the recorded step rather than continuing through the intervention condition automatically.

## Live-session handoff

The existing session was preserved across the handoff.

HUMAN acquired control at \`${acquired.occurredAt}\`.

No new run or replacement session is represented in this frozen package.

## Manual resolution

At \`${manual.occurredAt}\`, the audit trail recorded the following manual resolution:

${manual.summary}

The evidence package records semantic human actions only. It does not persist raw mouse coordinates, keystrokes, cookies, tokens, credentials, BrowserContext objects, or Page handles.

## Resume

Automation control was restored at \`${restored.occurredAt}\`.

The persisted terminal run status is \`${input.terminalStatus}\`.

## Screenshot evidence

${screenshotLines}

Only the four handoff checkpoints are copied into this reviewer package.

## Files

- \`run.json\` — sanitized source-run metadata
- \`intervention.json\` — sanitized persisted intervention, human actions, and audit trail
- \`events.jsonl\` — sanitized structured event log from the same logical run
- \`result.json\` — sanitized terminal result from the same logical run
- \`screenshots/\` — the four correlated handoff screenshots
- \`SHA256SUMS.txt\` — SHA-256 integrity hashes for every frozen file

## Integrity

\`SHA256SUMS.txt\` can be used to verify that the frozen reviewer files have not changed after packaging.
`;

  await writeFile(join(input.directory, 'README.md'), markdown, 'utf8');
}

async function filesRecursively(directory: string): Promise<string[]> {
  const entries = await readdir(directory, {
    withFileTypes: true,
  });

  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === 'SHA256SUMS.txt') {
      continue;
    }

    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await filesRecursively(path)));

      continue;
    }

    files.push(path);
  }

  return files.sort();
}

async function writeChecksums(directory: string): Promise<void> {
  const files = await filesRecursively(directory);

  const lines: string[] = [];

  for (const file of files) {
    const bytes = await readFile(file);

    const digest = createHash('sha256').update(bytes).digest('hex');

    const name = relative(directory, file).replaceAll('\\', '/');

    lines.push(`${digest}  ${name}`);
  }

  await writeFile(
    join(directory, 'SHA256SUMS.txt'),

    `${lines.join('\n')}\n`,

    'utf8',
  );
}

function parseJsonLines(contents: string): unknown[] {
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

function parseJsonObject(contents: string, filename: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(contents);

  if (!isRecord(parsed)) {
    throw new Error(`${filename} must contain a JSON object`);
  }

  return parsed;
}

function stringProperty(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];

  return typeof value === 'string' ? value : undefined;
}

function requireNonEmpty(value: string, name: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error(`${name} must not be empty`);
  }

  return trimmed;
}

function assertWithinDirectory(
  rootDirectory: string,
  candidatePath: string,
  message: string,
): void {
  const root = resolve(rootDirectory);

  const candidate = resolve(candidatePath);

  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    throw new Error(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
