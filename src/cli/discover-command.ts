import { ModelConfigurationError } from '../discovery/index.js';

import {
  DISCOVER_USAGE,
  DiscoveryCliUsageError,
  parseDiscoverCommandOptions,
} from './discover-options.js';
import type { DiscoverCommandOptions } from './discover-options.js';
import type { DiscoveryAssignmentExecution } from './discover-runtime.js';

export interface DiscoveryCliIo {
  writeOut(value: string): void;
  writeError(value: string): void;
}

export interface DiscoveryCliDependencies {
  readonly execute: (options: DiscoverCommandOptions) => Promise<DiscoveryAssignmentExecution>;
  readonly io: DiscoveryCliIo;
}

function terminalExitCode(execution: DiscoveryAssignmentExecution): number {
  switch (execution.result.status) {
    case 'success':
      return 0;
    case 'business_outcome':
    case 'intervention_required':
      return 2;
    case 'failure':
      return 1;
  }
}

function safeError(error: unknown): object {
  if (error instanceof ModelConfigurationError) {
    return error.toJSON();
  }

  if (error instanceof DiscoveryCliUsageError) {
    return {
      name: error.name,
      code: error.code,
      message: error.message,
    };
  }

  return {
    name: 'DiscoveryCliError',
    code: 'DISCOVERY_CLI_FAILED',
    message: 'Discovery command failed',
  };
}

export async function runDiscoveryCli(
  args: readonly string[],
  dependencies: DiscoveryCliDependencies,
): Promise<number> {
  try {
    const parsed = parseDiscoverCommandOptions(args);

    if (parsed.kind === 'help') {
      dependencies.io.writeOut(`${DISCOVER_USAGE}\n`);
      return 0;
    }

    const execution = await dependencies.execute(parsed.options);

    dependencies.io.writeOut(
      `${JSON.stringify(
        {
          result: execution.result,
          evidenceDirectory: execution.evidenceDirectory,
          target: execution.target,
        },
        null,
        2,
      )}\n`,
    );

    return terminalExitCode(execution);
  } catch (error) {
    dependencies.io.writeError(`${JSON.stringify({ error: safeError(error) }, null, 2)}\n`);
    return error instanceof DiscoveryCliUsageError ? 64 : 1;
  }
}
