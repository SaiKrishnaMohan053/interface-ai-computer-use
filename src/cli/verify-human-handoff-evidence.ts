import { verifyHumanHandoffEvidenceIntegrity } from '../intervention/intervention-evidence-integrity.js';

async function main(): Promise<void> {
  const packageDirectory = process.argv[2] ?? 'evidence/human-handoff';

  const result = await verifyHumanHandoffEvidenceIntegrity(packageDirectory);

  process.stdout.write(
    [
      'Human handoff evidence integrity verified.',
      `Package: ${result.packageDirectory}`,
      `Manifest: ${result.manifestPath}`,
      `Files verified: ${result.entries.length}`,
      '',
    ].join('\n'),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  process.stderr.write(`Human handoff evidence integrity verification failed: ${message}\n`);

  process.exitCode = 1;
});
