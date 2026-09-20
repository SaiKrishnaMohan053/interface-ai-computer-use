import { readFile, readdir } from 'node:fs/promises';

import { extname, join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPLAY_ROOT = join(process.cwd(), 'src', 'replay');

const FORBIDDEN_IMPORT_FRAGMENTS = [
  '/discovery/',
  '\\discovery\\',

  '/model/',
  '\\model\\',

  'openai',

  'DiscoveryDecisionModel',

  'OpenAIDiscoveryDecisionModel',
] as const;

async function sourceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, {
    withFileTypes: true,
  });

  const files: string[] = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(path)));

      continue;
    }

    if (entry.isFile() && ['.ts', '.tsx'].includes(extname(entry.name))) {
      files.push(path);
    }
  }

  return files;
}

function importSpecifiers(source: string): readonly string[] {
  const specifiers: string[] = [];

  const expression = /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/gu;

  for (const match of source.matchAll(expression)) {
    const specifier = match[1];

    if (specifier !== undefined) {
      specifiers.push(specifier);
    }
  }

  return specifiers;
}

describe('replay architecture has no LLM dependency', () => {
  it('contains no direct imports from discovery or model modules', async () => {
    const files = await sourceFiles(REPLAY_ROOT);

    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');

      const imports = importSpecifiers(source);

      for (const specifier of imports) {
        const normalized = specifier.toLowerCase();

        if (
          FORBIDDEN_IMPORT_FRAGMENTS.some((fragment) => normalized.includes(fragment.toLowerCase()))
        ) {
          violations.push(`${relative(process.cwd(), file)}: ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('contains no OpenAI or discovery model class references anywhere in replay source', async () => {
    const files = await sourceFiles(REPLAY_ROOT);

    const violations: string[] = [];

    const forbiddenSymbols = [
      'OpenAI',
      'DiscoveryDecisionModel',
      'OpenAIDiscoveryDecisionModel',
      'OPENAI_API_KEY',
      'OPENAI_MODEL',
    ];

    for (const file of files) {
      const source = await readFile(file, 'utf8');

      for (const symbol of forbiddenSymbols) {
        if (source.includes(symbol)) {
          violations.push(`${relative(process.cwd(), file)}: ${symbol}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('does not import the discovery package root indirectly', async () => {
    const files = await sourceFiles(REPLAY_ROOT);

    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');

      const imports = importSpecifiers(source);

      for (const specifier of imports) {
        if (specifier === '../discovery/index.js' || specifier === '../../discovery/index.js') {
          violations.push(relative(process.cwd(), file));
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
