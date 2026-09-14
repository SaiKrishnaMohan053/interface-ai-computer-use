import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runDiscoveryCli } from './discover-command.js';
import { runDiscoveryAssignment } from './discover-runtime.js';

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  return runDiscoveryCli(args, {
    execute: (options) => runDiscoveryAssignment(options),
    io: {
      writeOut: (value) => process.stdout.write(value),
      writeError: (value) => process.stderr.write(value),
    },
  });
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isEntryPoint) {
  process.exitCode = await main();
}
