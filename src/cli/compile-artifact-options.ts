export interface CompileArtifactCommandOptions {
  readonly source: string;
  readonly config: string;
  readonly artifactRoot: string;
}

export type CompileArtifactCommandParseResult =
  | {
      readonly kind: 'help';
    }
  | {
      readonly kind: 'run';
      readonly options: CompileArtifactCommandOptions;
    };

export class CompileArtifactCliUsageError extends Error {
  readonly code = 'COMPILE_ARTIFACT_CLI_USAGE_INVALID';

  constructor(message: string) {
    super(message);

    this.name = 'CompileArtifactCliUsageError';
  }
}

export const COMPILE_ARTIFACT_USAGE = [
  'Usage:',
  '  npm run compile-artifact -- --source <evidence-directory> --config <capability-config>',
  '',
  'Options:',
  '  --source <path>          Successful discovery evidence directory',
  '  --config <path>          Capability compilation config',
  '  --artifact-root <path>   Artifact storage root (default: artifacts)',
  '  --help                   Show this help',
].join('\n');

function optionValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];

  if (value === undefined || value.startsWith('--')) {
    throw new CompileArtifactCliUsageError(`${option} requires a value`);
  }

  return value;
}

export function parseCompileArtifactCommandOptions(
  args: readonly string[],
): CompileArtifactCommandParseResult {
  if (args.includes('--help')) {
    return {
      kind: 'help',
    };
  }

  let source: string | undefined;

  let config: string | undefined;

  let artifactRoot = 'artifacts';

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    switch (argument) {
      case '--source':
        source = optionValue(args, index, argument);

        index += 1;
        break;

      case '--config':
        config = optionValue(args, index, argument);

        index += 1;
        break;

      case '--artifact-root':
        artifactRoot = optionValue(args, index, argument);

        index += 1;
        break;

      default:
        throw new CompileArtifactCliUsageError(`Unsupported option: ${argument ?? ''}`);
    }
  }

  if (source === undefined || source.trim().length === 0) {
    throw new CompileArtifactCliUsageError('--source is required');
  }

  if (config === undefined || config.trim().length === 0) {
    throw new CompileArtifactCliUsageError('--config is required');
  }

  if (artifactRoot.trim().length === 0) {
    throw new CompileArtifactCliUsageError('--artifact-root must not be empty');
  }

  return {
    kind: 'run',

    options: {
      source: source.trim(),

      config: config.trim(),

      artifactRoot: artifactRoot.trim(),
    },
  };
}
