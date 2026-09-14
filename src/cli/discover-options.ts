export interface DiscoverCommandOptions {
  readonly goal: string;
  readonly target?: string;
  readonly application: string;
  readonly headed: boolean;
  readonly syntheticScreenshots: boolean;
  readonly evidenceRoot: string;
  readonly maxSteps?: number;
  readonly timeoutMs?: number;
}

export type DiscoverCommandParseResult =
  { readonly kind: 'help' } | { readonly kind: 'run'; readonly options: DiscoverCommandOptions };

export class DiscoveryCliUsageError extends Error {
  readonly code = 'DISCOVERY_CLI_USAGE_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'DiscoveryCliUsageError';
  }
}

export const DISCOVER_USAGE = [
  'Usage:',
  '  npm run discover -- --goal <goal> [options]',
  '',
  'Options:',
  '  --target <url>             Connect to an existing target; otherwise start the demo',
  '  --application <name>       Application label (default: Demo Credit Union)',
  '  --headed                   Launch a visible browser',
  '  --synthetic-screenshots    Declare the connected target synthetic and persist screenshots',
  '  --evidence-root <path>     Evidence directory root (default: evidence)',
  '  --max-steps <number>       Bounded discovery step limit',
  '  --timeout-ms <number>      Bounded discovery runtime in milliseconds',
  '  --help                     Show this help',
].join('\n');

function optionValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];

  if (value === undefined || value.startsWith('--')) {
    throw new DiscoveryCliUsageError(`${option} requires a value`);
  }

  return value;
}

function positiveInteger(value: string, option: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new DiscoveryCliUsageError(`${option} must be a positive integer`);
  }

  return parsed;
}

export function parseDiscoverCommandOptions(args: readonly string[]): DiscoverCommandParseResult {
  if (args.includes('--help')) return { kind: 'help' };

  let goal: string | undefined;
  let target: string | undefined;
  let application = 'Demo Credit Union';
  let evidenceRoot = 'evidence';
  let maxSteps: number | undefined;
  let timeoutMs: number | undefined;
  let headed = false;
  let syntheticScreenshots = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    switch (argument) {
      case '--goal':
        goal = optionValue(args, index, argument);
        index += 1;
        break;
      case '--target':
        target = optionValue(args, index, argument);
        index += 1;
        break;
      case '--application':
        application = optionValue(args, index, argument);
        index += 1;
        break;
      case '--evidence-root':
        evidenceRoot = optionValue(args, index, argument);
        index += 1;
        break;
      case '--max-steps':
        maxSteps = positiveInteger(optionValue(args, index, argument), argument);
        index += 1;
        break;
      case '--timeout-ms':
        timeoutMs = positiveInteger(optionValue(args, index, argument), argument);
        index += 1;
        break;
      case '--headed':
        headed = true;
        break;
      case '--synthetic-screenshots':
        syntheticScreenshots = true;
        break;
      default:
        throw new DiscoveryCliUsageError(`Unsupported option: ${argument ?? ''}`);
    }
  }

  if (goal === undefined || goal.trim().length === 0) {
    throw new DiscoveryCliUsageError('--goal is required');
  }

  if (application.trim().length === 0) {
    throw new DiscoveryCliUsageError('--application must not be empty');
  }

  if (evidenceRoot.trim().length === 0) {
    throw new DiscoveryCliUsageError('--evidence-root must not be empty');
  }

  if (target !== undefined) {
    if (!URL.canParse(target)) {
      throw new DiscoveryCliUsageError('--target must be a valid URL');
    }

    const parsedTarget = new URL(target);

    if (
      !['http:', 'https:'].includes(parsedTarget.protocol) ||
      parsedTarget.username.length > 0 ||
      parsedTarget.password.length > 0
    ) {
      throw new DiscoveryCliUsageError('--target must be an HTTP(S) URL without credentials');
    }
  }

  return {
    kind: 'run',
    options: {
      goal: goal.trim(),
      ...(target === undefined ? {} : { target }),
      application: application.trim(),
      headed,
      syntheticScreenshots,
      evidenceRoot,
      ...(maxSteps === undefined ? {} : { maxSteps }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    },
  };
}
