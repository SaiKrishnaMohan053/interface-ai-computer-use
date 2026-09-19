import {
  COMPILE_ARTIFACT_USAGE,
  CompileArtifactCliUsageError,
  parseCompileArtifactCommandOptions,
} from './compile-artifact-options.js';

import type { ArtifactCompilationExecution } from './compile-artifact-runtime.js';

export interface CompileArtifactCliIo {
  writeOut(value: string): void;

  writeError(value: string): void;
}

export interface CompileArtifactCliDependencies {
  readonly execute: (
    options: Extract<
      ReturnType<typeof parseCompileArtifactCommandOptions>,
      {
        readonly kind: 'run';
      }
    >['options'],
  ) => Promise<ArtifactCompilationExecution>;

  readonly io: CompileArtifactCliIo;
}

function summary(execution: ArtifactCompilationExecution): string {
  const artifact = execution.artifact;

  const inputs = artifact.inputs.map((input) => `${input.name}:${input.type}`).join(', ');

  const outputs = artifact.outputs.map((output) => `${output.name}:${output.type}`).join(', ');

  return [
    'Artifact compiled successfully',
    '',
    `Capability : ${artifact.identity.id}`,
    `Version    : ${artifact.identity.version}`,
    `Inputs     : ${inputs || '(none)'}`,
    `Outputs    : ${outputs || '(none)'}`,
    `Steps      : ${artifact.steps.length}`,
    `Risk       : ${artifact.risk.summaryRisk} (max step: ${artifact.risk.maxStepRisk})`,
    `Stored     : ${execution.storedPath}`,
    `SHA-256    : ${execution.sha256}`,
    '',
  ].join('\n');
}

function safeError(error: unknown): object {
  if (error instanceof CompileArtifactCliUsageError) {
    return {
      name: error.name,

      code: error.code,

      message: error.message,
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,

      code: 'COMPILE_ARTIFACT_FAILED',

      message: error.message,
    };
  }

  return {
    name: 'CompileArtifactCliError',

    code: 'COMPILE_ARTIFACT_FAILED',

    message: 'Artifact compilation failed',
  };
}

export async function runCompileArtifactCli(
  args: readonly string[],
  dependencies: CompileArtifactCliDependencies,
): Promise<number> {
  try {
    const parsed = parseCompileArtifactCommandOptions(args);

    if (parsed.kind === 'help') {
      dependencies.io.writeOut(`${COMPILE_ARTIFACT_USAGE}\n`);

      return 0;
    }

    const execution = await dependencies.execute(parsed.options);

    dependencies.io.writeOut(summary(execution));

    return 0;
  } catch (error) {
    dependencies.io.writeError(
      `${JSON.stringify(
        {
          error: safeError(error),
        },
        null,
        2,
      )}\n`,
    );

    return error instanceof CompileArtifactCliUsageError ? 64 : 1;
  }
}
