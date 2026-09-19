import { resolve } from 'node:path';

import { fileURLToPath } from 'node:url';

import { runCompileArtifactCli } from './compile-artifact-command.js';

import { runArtifactCompilation } from './compile-artifact-runtime.js';

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  return runCompileArtifactCli(args, {
    execute: runArtifactCompilation,

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
