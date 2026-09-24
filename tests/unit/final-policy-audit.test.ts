import { readFile, readdir } from 'node:fs/promises';

import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

async function sourceFiles(directory: string): Promise<string[]> {
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

    if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(path);
    }
  }

  return files.sort();
}

function occurrences(text: string, value: string): number {
  return text.split(value).length - 1;
}

describe('final automated-action policy audit', () => {
  it('keeps discovery surface execution behind DISCOVERY ownership checks', async () => {
    const source = await readFile('src/discovery/discovery-engine.ts', 'utf8');

    expect(occurrences(source, 'context.surface.perform(')).toBe(2);

    expect(occurrences(source, 'assertDiscoveryActionOwnership(context);')).toBeGreaterThanOrEqual(
      2,
    );

    const performIndexes = [...source.matchAll(/context\.surface\.perform\(/g)].map(
      (match) => match.index,
    );

    for (const index of performIndexes) {
      const precedingWindow = source.slice(Math.max(0, index - 800), index);

      expect(precedingWindow).toContain('assertDiscoveryActionOwnership(context);');
    }
  });

  it('keeps normal and recovery replay execution behind the shared ownership boundary', async () => {
    const ownedAction = await readFile('src/replay/replay-owned-action.ts', 'utf8');

    expect(ownedAction).toContain('input.assertAutomationOwnership();');

    expect(ownedAction).toContain('input.surface.perform(input.request, input.options)');

    const interstitial = await readFile('src/replay/replay-known-interstitial.ts', 'utf8');

    expect(interstitial).toContain('performReplayOwnedAction({');

    expect(interstitial).toContain('assertAutomationOwnership: input.assertAutomationOwnership');

    expect(interstitial).not.toContain('input.adapter.perform(');

    const executor = await readFile('src/replay/replay-browser-step-executor.ts', 'utf8');

    expect(occurrences(executor, 'recoverKnownReplayInterstitial({')).toBe(2);

    expect(
      occurrences(executor, 'assertAutomationOwnership: this.options.assertAutomationOwnership'),
    ).toBeGreaterThanOrEqual(3);
  });

  it('policy-checks and ownership-checks frozen replay bootstrap navigation', async () => {
    const source = await readFile('src/cli/freeze-replay-evidence.ts', 'utf8');

    const policyIndex = source.indexOf('const entryPolicy = context.policyEngine.evaluate({');

    const ownershipIndex = source.indexOf("context.sessionManager.access('REPLAY');", policyIndex);

    const performIndex = source.indexOf('context.surface.perform(', ownershipIndex);

    expect(policyIndex).toBeGreaterThanOrEqual(0);
    expect(ownershipIndex).toBeGreaterThan(policyIndex);
    expect(performIndex).toBeGreaterThan(ownershipIndex);

    const policyWindow = source.slice(policyIndex, ownershipIndex);

    expect(policyWindow).toContain("systemRiskLevel: 'READ_ONLY'");

    expect(policyWindow).toContain("kind: 'navigate'");

    expect(policyWindow).toContain("entryPolicy.decision !== 'ALLOW'");
  });

  it('does not introduce additional direct SurfaceAdapter.perform automation paths', async () => {
    const files = await sourceFiles('src');

    const directPerformFiles: string[] = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');

      if (source.includes('.perform(')) {
        directPerformFiles.push(relative('.', file).replaceAll('\\', '/'));
      }
    }

    expect(directPerformFiles).toEqual([
      'src/cli/freeze-replay-evidence.ts',
      'src/discovery/discovery-engine.ts',
      'src/replay/replay-owned-action.ts',
    ]);
  });
});
