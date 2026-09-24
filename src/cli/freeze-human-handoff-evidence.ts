import { resolve } from 'node:path';

import {
  FileSystemInterventionStore,
  freezeHumanHandoffEvidencePackage,
} from '../intervention/index.js';

const interventionId = process.argv[2]?.trim();

const runId = process.argv[3]?.trim();

if (
  interventionId === undefined ||
  interventionId.length === 0 ||
  runId === undefined ||
  runId.length === 0
) {
  throw new Error('Usage: npm run freeze-human-handoff-evidence -- <intervention-id> <run-id>');
}

const store = new FileSystemInterventionStore();

const intervention = await store.get(interventionId);

if (intervention === undefined) {
  throw new Error(`Intervention not found: ${interventionId}`);
}

const frozen = await freezeHumanHandoffEvidencePackage({
  sourceEvidenceRoot: resolve('evidence'),

  runId,

  outputDirectory: resolve('evidence', 'human-handoff'),

  intervention,
});

process.stdout.write(`Human handoff evidence frozen at ${frozen.outputDirectory}\n`);
