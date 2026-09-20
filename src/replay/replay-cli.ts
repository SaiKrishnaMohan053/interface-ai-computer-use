import type { CapabilityArtifact } from '../artifact/index.js';

import type { RuntimeResult } from '../runtime/index.js';

export interface ReplayCliOptions {
  readonly capability: string;
  readonly version: string;

  readonly input: Readonly<Record<string, unknown>>;

  readonly headed: boolean;

  readonly syntheticScreenshots: boolean;
}

export interface ReplayCliDependencies {
  readonly loadArtifact: (capability: string, version: string) => Promise<CapabilityArtifact>;

  readonly validateInputs: (
    artifact: CapabilityArtifact,
    input: Readonly<Record<string, unknown>>,
  ) => Readonly<Record<string, unknown>>;

  readonly runReplay: (input: {
    readonly artifact: CapabilityArtifact;

    readonly inputs: Readonly<Record<string, unknown>>;

    readonly headed: boolean;

    readonly syntheticScreenshots: boolean;
  }) => Promise<{
    readonly result: RuntimeResult;

    readonly evidenceLocation: string | null;
  }>;
}

export interface ReplayCliIo {
  readonly stdout: (value: string) => void;

  readonly stderr: (value: string) => void;
}

export interface ReplayCliExecutionResult {
  readonly exitCode: number;
}

export class ReplayCliArgumentError extends Error {
  constructor(message: string) {
    super(message);

    this.name = 'ReplayCliArgumentError';
  }
}

function requireValue(argv: readonly string[], index: number, option: string): string {
  const value = argv[index + 1];

  if (value === undefined || value.startsWith('--')) {
    throw new ReplayCliArgumentError(`${option} requires a value`);
  }

  return value;
}

function parseInput(raw: string): Readonly<Record<string, unknown>> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ReplayCliArgumentError('--input must contain valid JSON');
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ReplayCliArgumentError('--input must be a JSON object');
  }

  return parsed as Readonly<Record<string, unknown>>;
}

export function parseReplayCliArgs(argv: readonly string[]): ReplayCliOptions {
  let capability: string | undefined;

  let version: string | undefined;

  let rawInput: string | undefined;

  let headed = false;

  let syntheticScreenshots = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    switch (argument) {
      case '--capability':
        capability = requireValue(argv, index, argument);

        index += 1;
        break;

      case '--version':
        version = requireValue(argv, index, argument);

        index += 1;
        break;

      case '--input':
        rawInput = requireValue(argv, index, argument);

        index += 1;
        break;

      case '--headed':
        headed = true;
        break;

      case '--synthetic-screenshots':
        syntheticScreenshots = true;
        break;

      default:
        throw new ReplayCliArgumentError(`Unknown replay option "${argument}"`);
    }
  }

  if (capability === undefined || capability.trim().length === 0) {
    throw new ReplayCliArgumentError('--capability is required');
  }

  if (version === undefined || version.trim().length === 0) {
    throw new ReplayCliArgumentError('--version is required');
  }

  if (rawInput === undefined) {
    throw new ReplayCliArgumentError('--input is required');
  }

  return {
    capability,
    version,
    input: parseInput(rawInput),
    headed,
    syntheticScreenshots,
  };
}

function structured(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export async function runReplayCli(
  argv: readonly string[],
  dependencies: ReplayCliDependencies,
  io: ReplayCliIo,
): Promise<ReplayCliExecutionResult> {
  try {
    const options = parseReplayCliArgs(argv);

    const artifact = await dependencies.loadArtifact(options.capability, options.version);

    const validatedInputs = dependencies.validateInputs(artifact, options.input);

    const execution = await dependencies.runReplay({
      artifact,

      inputs: validatedInputs,

      headed: options.headed,

      syntheticScreenshots: options.syntheticScreenshots,
    });

    io.stdout(
      structured({
        result: execution.result,

        evidenceLocation: execution.evidenceLocation,
      }),
    );

    return {
      exitCode: execution.result.status === 'success' ? 0 : 1,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown replay CLI failure';

    io.stderr(
      structured({
        status: 'failure',

        error: {
          message,
        },
      }),
    );

    return {
      exitCode: 1,
    };
  }
}
