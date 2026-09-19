import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { dirname, join, relative, resolve } from 'node:path';

import { z } from 'zod';

import {
  ArtifactCompiler,
  ArtifactStore,
  artifactSuccessConditionSchema,
  assertArtifactSafeToPersist,
  capabilityCompatibilitySchema,
  capabilityIdentitySchema,
  capabilityInputSchema,
  capabilityMetadataSchema,
  capabilityOutputSchema,
  capabilityRiskMetadataSchema,
  capabilityStepIdSchema,
  knownBusinessOutcomeSchema,
  parseCapabilityArtifact,
  recoveryPolicySchema,
  serializeCapabilityArtifact,
  sha256CapabilityArtifact,
  validateCapabilityArtifactSemantics,
  waitPolicySchema,
  type CapabilityArtifact,
  type CompileOptions,
  type CompileOutputBinding,
  type CompileStepMetadata,
  type DiscoveryArtifactSource,
} from '../artifact/index.js';

import { conditionSpecSchema } from '../conditions/index.js';

import {
  parseDiscoveryRequest,
  parseDiscoveryRunResult,
  parseDiscoveryTraceRecord,
  type DiscoveryExtractionRecord,
  type DiscoveryTraceRecord,
} from '../discovery/index.js';

import type { CompileArtifactCommandOptions } from './compile-artifact-options.js';

const stepConfigSchema = z
  .object({
    sourceStep: z.number().int().positive(),

    id: capabilityStepIdSchema,

    description: z.string().trim().min(1),

    preconditions: z.array(conditionSpecSchema).min(1).optional(),

    wait: waitPolicySchema.optional(),

    postconditions: z.array(conditionSpecSchema).min(1).optional(),

    recovery: z.array(recoveryPolicySchema).min(1).optional(),
  })
  .strict();

const inputDiscoveryBindingSchema = z
  .object({
    inputName: z.string().trim().min(1),

    sourceStep: z.number().int().positive(),

    actionKind: z.literal('type'),

    field: z.literal('text'),
  })
  .strict();

const outputDiscoveryBindingSchema = z
  .object({
    outputName: z.string().trim().min(1),

    sourceStep: z.number().int().positive(),

    actionKind: z.literal('read'),
  })
  .strict();

const compileArtifactConfigSchema = z
  .object({
    compiledAt: z.iso.datetime({
      offset: true,
    }),

    sourceGoal: z.string().trim().min(1),

    identity: capabilityIdentitySchema,

    compatibility: capabilityCompatibilitySchema,

    inputs: z.array(capabilityInputSchema),

    outputs: z.array(capabilityOutputSchema),

    discoveryBindings: z
      .object({
        inputs: z.array(inputDiscoveryBindingSchema),

        outputs: z.array(outputDiscoveryBindingSchema),
      })
      .strict(),

    preconditions: z.array(conditionSpecSchema).optional(),

    steps: z.array(stepConfigSchema).min(1),

    knownBusinessOutcomes: z.array(knownBusinessOutcomeSchema).optional(),

    successCondition: artifactSuccessConditionSchema,

    risk: capabilityRiskMetadataSchema,

    metadata: capabilityMetadataSchema.optional(),
  })
  .strict();

type CompileArtifactConfig = z.infer<typeof compileArtifactConfigSchema>;

interface FrozenRunEnvelope {
  readonly runId: string;

  readonly metadata: {
    readonly value: {
      readonly application: string;

      readonly goal: string;

      readonly maxSteps: number;
    };
  };
}

interface FrozenResultEnvelope {
  readonly runId: string;

  readonly startedAt: string;

  readonly finishedAt: string;

  readonly durationMs: number;

  readonly result: {
    readonly outputs: Record<string, unknown>;
  };

  readonly evidenceRefs: readonly unknown[];
}

interface FrozenEvent {
  readonly step: number;

  readonly eventType: string;

  readonly action: {
    readonly kind?: string;

    readonly destination?: string;
  } | null;

  readonly result: Record<string, unknown> | null;
}

export interface ArtifactCompilationExecution {
  readonly artifact: CapabilityArtifact;

  readonly storedPath: string;

  readonly sha256: string;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function readEvents(directory: string): Promise<readonly FrozenEvent[]> {
  const contents = await readFile(join(directory, 'events.jsonl'), 'utf8');

  return contents
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as FrozenEvent);
}

function extractTrace(events: readonly FrozenEvent[]): readonly DiscoveryTraceRecord[] {
  return events
    .filter((event) => event.eventType === 'discovery_trace')
    .map((event) => parseDiscoveryTraceRecord(event.result));
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

  throw new Error('Discovery evidence has no session lifecycle sessionId');
}

function findEntryUrl(events: readonly FrozenEvent[]): string {
  for (const event of events) {
    if (event.action?.kind === 'navigate' && typeof event.action.destination === 'string') {
      return event.action.destination;
    }
  }

  throw new Error('Discovery evidence has no initial navigation URL');
}

function modelDecisionAtStep(trace: readonly DiscoveryTraceRecord[], step: number) {
  const record = trace.find(
    (
      candidate,
    ): candidate is Extract<
      DiscoveryTraceRecord,
      {
        readonly kind: 'model_decision';
      }
    > => candidate.kind === 'model_decision' && candidate.step === step,
  );

  if (record === undefined) {
    throw new Error(`Discovery evidence has no model decision at step ${step}`);
  }

  return record;
}

function extractRequestParameters(
  trace: readonly DiscoveryTraceRecord[],
  config: CompileArtifactConfig,
): Record<string, unknown> {
  const parameters: Record<string, unknown> = {};

  for (const binding of config.discoveryBindings.inputs) {
    const record = modelDecisionAtStep(trace, binding.sourceStep);

    if (record.decision.kind !== 'type') {
      throw new Error(
        `Input "${binding.inputName}" expected a type action at discovery step ${binding.sourceStep}`,
      );
    }

    parameters[binding.inputName] = record.decision.text;
  }

  return parameters;
}

function findActionId(events: readonly FrozenEvent[], step: number, actionKind: string): string {
  const event = events.find(
    (candidate) =>
      candidate.eventType === 'action' &&
      candidate.step === step &&
      candidate.action?.kind === actionKind &&
      candidate.result !== null,
  );

  const actionId = event?.result?.actionId;

  if (typeof actionId !== 'string' || actionId.length === 0) {
    throw new Error(`Discovery evidence has no actionId for ${actionKind} step ${step}`);
  }

  return actionId;
}

function buildExtractions(
  events: readonly FrozenEvent[],
  trace: readonly DiscoveryTraceRecord[],
  config: CompileArtifactConfig,
): {
  readonly extractions: readonly DiscoveryExtractionRecord[];

  readonly outputBindings: CompileOptions['outputBindings'];

  readonly forbiddenValues: readonly string[];
} {
  const extractions: DiscoveryExtractionRecord[] = [];

  const outputBindings: CompileOutputBinding[] = [];

  const forbiddenValues: string[] = [];

  for (const binding of config.discoveryBindings.outputs) {
    const record = modelDecisionAtStep(trace, binding.sourceStep);

    if (record.decision.kind !== 'read') {
      throw new Error(
        `Output "${binding.outputName}" expected a read action at discovery step ${binding.sourceStep}`,
      );
    }

    const result = trace.find(
      (
        candidate,
      ): candidate is Extract<
        DiscoveryTraceRecord,
        {
          readonly kind: 'action_result';
        }
      > =>
        candidate.kind === 'action_result' &&
        candidate.step === binding.sourceStep &&
        candidate.actionKind === 'read' &&
        candidate.status === 'success',
    );

    if (result === undefined) {
      throw new Error(
        `Discovery evidence has no successful read result at step ${binding.sourceStep}`,
      );
    }

    const observation = trace.find(
      (
        candidate,
      ): candidate is Extract<
        DiscoveryTraceRecord,
        {
          readonly kind: 'observation';
        }
      > => candidate.kind === 'observation' && candidate.step === binding.sourceStep,
    );

    if (observation === undefined) {
      throw new Error(`Discovery evidence has no observation at read step ${binding.sourceStep}`);
    }

    const sourceOutputName = record.decision.saveAs;

    const value = result.extractedValues[sourceOutputName];

    if (value === undefined) {
      throw new Error(`Read result has no extracted value "${sourceOutputName}"`);
    }

    extractions.push({
      outputName: sourceOutputName,

      value,

      source: 'surface_read',

      step: binding.sourceStep,

      observationId: observation.observationId,

      actionId: findActionId(events, binding.sourceStep, 'read'),
    });

    outputBindings.push({
      sourceOutputName,

      outputName: binding.outputName,
    });

    if (typeof value === 'string') {
      forbiddenValues.push(value);
    }
  }

  return {
    extractions,
    outputBindings,
    forbiddenValues,
  };
}

async function loadSource(
  directory: string,
  config: CompileArtifactConfig,
): Promise<{
  readonly source: DiscoveryArtifactSource;

  readonly outputBindings: CompileOptions['outputBindings'];

  readonly forbiddenSourceLiterals: readonly string[];
}> {
  const [run, resultEnvelope, events] = await Promise.all([
    readJson<FrozenRunEnvelope>(join(directory, 'run.json')),

    readJson<FrozenResultEnvelope>(join(directory, 'result.json')),

    readEvents(directory),
  ]);

  if (run.runId !== resultEnvelope.runId) {
    throw new Error('Discovery evidence run IDs do not match');
  }

  const trace = extractTrace(events);

  const parameters = extractRequestParameters(trace, config);

  const forbiddenSourceLiterals = Object.values(parameters).filter(
    (value): value is string => typeof value === 'string',
  );

  const { extractions, outputBindings, forbiddenValues } = buildExtractions(events, trace, config);

  forbiddenSourceLiterals.push(...forbiddenValues);

  const request = parseDiscoveryRequest({
    goal: run.metadata.value.goal,

    target: {
      entryUrl: findEntryUrl(events),

      application: run.metadata.value.application,
    },

    parameters,

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

  return {
    source: {
      runId: run.runId,

      request,

      result,

      trace,

      extractions,
    },

    outputBindings,

    forbiddenSourceLiterals,
  };
}

async function loadConfig(path: string): Promise<CompileArtifactConfig> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;

  return compileArtifactConfigSchema.parse(raw);
}

function buildCompileSteps(config: CompileArtifactConfig): readonly CompileStepMetadata[] {
  return config.steps.map((step): CompileStepMetadata => ({
    sourceStep: step.sourceStep,

    id: step.id,

    description: step.description,

    ...(step.preconditions === undefined
      ? {}
      : {
          preconditions: step.preconditions,
        }),

    ...(step.wait === undefined
      ? {}
      : {
          wait: step.wait,
        }),

    ...(step.postconditions === undefined
      ? {}
      : {
          postconditions: step.postconditions,
        }),

    ...(step.recovery === undefined
      ? {}
      : {
          recovery: step.recovery,
        }),
  }));
}

function buildCompileOptions(
  config: CompileArtifactConfig,
  outputBindings: CompileOptions['outputBindings'],
  forbiddenSourceLiterals: readonly string[],
): CompileOptions {
  return {
    compiledAt: config.compiledAt,

    sourceGoal: config.sourceGoal,

    identity: config.identity,

    compatibility: config.compatibility,

    inputs: config.inputs,

    outputs: config.outputs,

    preconditions: config.preconditions ?? [],

    steps: buildCompileSteps(config),

    outputBindings,

    ...(config.knownBusinessOutcomes === undefined
      ? {}
      : {
          knownBusinessOutcomes: config.knownBusinessOutcomes,
        }),

    successCondition: config.successCondition,

    risk: config.risk,

    metadata: config.metadata ?? {},

    forbiddenSourceLiterals,
  };
}

async function writeHashFile(storedPath: string, hash: string): Promise<void> {
  const hashPath = storedPath.replace(/\.json$/u, '.sha256');

  const contents = `${hash}  ${storedPath.split(/[\\/]/u).at(-1)}\n`;

  await mkdir(dirname(hashPath), {
    recursive: true,
  });

  await writeFile(hashPath, contents, 'utf8');
}

async function persistIdempotently(
  store: ArtifactStore,
  artifact: CapabilityArtifact,
): Promise<string> {
  const versions = await store.listVersions(artifact.identity.id);

  const expectedPath = join(
    store.rootDir,
    artifact.identity.id,
    `${artifact.identity.version}.json`,
  );

  if (versions.includes(artifact.identity.version)) {
    const existing = await store.load(artifact.identity.id, artifact.identity.version);

    if (serializeCapabilityArtifact(existing) !== serializeCapabilityArtifact(artifact)) {
      throw new Error(
        `Artifact ${artifact.identity.id} version ${artifact.identity.version} already exists with different content`,
      );
    }

    return expectedPath;
  }

  return store.save(artifact);
}

export async function runArtifactCompilation(
  options: CompileArtifactCommandOptions,
): Promise<ArtifactCompilationExecution> {
  const sourceDirectory = resolve(options.source);

  const configPath = resolve(options.config);

  const config = await loadConfig(configPath);

  const loaded = await loadSource(sourceDirectory, config);

  const artifact = new ArtifactCompiler().compile(
    loaded.source,

    buildCompileOptions(config, loaded.outputBindings, loaded.forbiddenSourceLiterals),
  );

  const parsed = parseCapabilityArtifact(artifact);

  validateCapabilityArtifactSemantics(parsed);

  assertArtifactSafeToPersist(parsed);

  const store = new ArtifactStore({
    rootDir: options.artifactRoot,
  });

  const storedPath = await persistIdempotently(store, parsed);

  const sha256 = sha256CapabilityArtifact(parsed);

  await writeHashFile(storedPath, sha256);

  return {
    artifact: parsed,

    storedPath: relative(process.cwd(), storedPath).replaceAll('\\', '/'),

    sha256,
  };
}
