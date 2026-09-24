import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

import { tmpdir } from 'node:os';

import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  freezeHumanHandoffEvidencePackage,
  storedInterventionSchema,
} from '../../src/intervention/index.js';

import type { EvidenceReference } from '../../src/surface/index.js';

const directories: string[] = [];

const NOW = '2026-09-23T20:00:00.000Z';

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'handoff-evidence-'));

  directories.push(root);

  return root;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,

        force: true,
      }),
    ),
  );
});

function screenshotReference(index: number): EvidenceReference {
  return {
    evidenceId: `screenshot-${index}`,

    runId: 'run-1',

    kind: 'screenshot',

    relativePath: `run-1/screenshots/screenshot-${String(index).padStart(4, '0')}.png`,

    mediaType: 'image/png',

    capturedAt: NOW,
  };
}

function intervention() {
  const refs = [1, 2, 3, 4].map(screenshotReference);

  return storedInterventionSchema.parse({
    request: {
      id: 'intervention-1',

      sessionId: 'session-1',

      source: 'REPLAY',

      capabilityId: 'prepare_new_savings_subaccount',

      capabilityVersion: '1.0.0',

      stepId: 'review-and-create',

      reasonCode: 'HUMAN_APPROVAL_REQUIRED',

      reason: 'Final create requires human involvement.',

      observedState: 'Synthetic sub-account review state.',

      evidenceRefs: refs,

      createdAt: NOW,

      status: 'RESOLVED',
    },

    acquisition: {
      acquisitionId: 'acquisition-1',

      acquiredAt: '2026-09-23T20:00:01.000Z',

      operatorId: 'operator-1',
    },

    resolution: {
      kind: 'RESUME',

      code: 'MANUAL_ACTION_COMPLETED',

      summary: 'Human completed the required manual action.',

      resolvedAt: '2026-09-23T20:00:04.000Z',

      evidenceRefs: [],
    },

    humanActions: [
      {
        actionId: 'acquisition-1',

        interventionId: 'intervention-1',

        sessionId: 'session-1',

        kind: 'CONTROL_ACQUIRED',

        summary: 'Human operator acquired intervention control.',

        occurredAt: '2026-09-23T20:00:01.000Z',

        evidenceRefs: [],

        details: {
          acquisitionId: 'acquisition-1',
        },
      },

      {
        actionId: 'manual-1',

        interventionId: 'intervention-1',

        sessionId: 'session-1',

        kind: 'MANUAL_STEP',

        summary: 'Human completed the required manual action.',

        occurredAt: '2026-09-23T20:00:02.000Z',

        evidenceRefs: [],

        details: {},
      },
    ],

    auditTrail: [
      {
        eventId: 'audit-created',

        interventionId: 'intervention-1',

        sessionId: 'session-1',

        type: 'intervention.created',

        actor: 'AUTOMATION',

        occurredAt: NOW,

        summary: 'Automation created an intervention.',

        source: 'REPLAY',

        evidenceRefs: [],
      },

      {
        eventId: 'audit-acquired',

        interventionId: 'intervention-1',

        sessionId: 'session-1',

        type: 'human.control_acquired',

        actor: 'HUMAN',

        occurredAt: '2026-09-23T20:00:01.000Z',

        summary: 'Human acquired control.',

        source: 'REPLAY',

        operatorId: 'operator-1',

        evidenceRefs: [],
      },

      {
        eventId: 'audit-manual',

        interventionId: 'intervention-1',

        sessionId: 'session-1',

        type: 'human.action_performed',

        actor: 'HUMAN',

        occurredAt: '2026-09-23T20:00:02.000Z',

        summary: 'Human completed the required manual action.',

        source: 'REPLAY',

        operatorId: 'operator-1',

        evidenceRefs: [],
      },

      {
        eventId: 'audit-restored',

        interventionId: 'intervention-1',

        sessionId: 'session-1',

        type: 'automation.control_restored',

        actor: 'AUTOMATION',

        occurredAt: '2026-09-23T20:00:03.000Z',

        summary: 'REPLAY control restored on the same live session.',

        source: 'REPLAY',

        evidenceRefs: [],
      },
    ],
  });
}

async function sourceEvidence(root: string): Promise<void> {
  const runDirectory = join(root, 'run-1');

  await mkdir(join(runDirectory, 'screenshots'), {
    recursive: true,
  });

  await writeFile(
    join(runDirectory, 'run.json'),

    JSON.stringify({
      runId: 'run-1',

      mode: 'REPLAY',
    }),

    'utf8',
  );

  await writeFile(
    join(runDirectory, 'result.json'),

    JSON.stringify({
      runId: 'run-1',

      mode: 'REPLAY',

      status: 'success',
    }),

    'utf8',
  );

  const checkpoints = [
    'BEFORE_INTERVENTION',
    'HUMAN_CONTROL',
    'HUMAN_RESOLUTION',
    'AUTOMATION_RESUMED',
  ] as const;

  const events = checkpoints.map((checkpoint, index) => {
    const reference = screenshotReference(index + 1);

    return JSON.stringify({
      timestamp: NOW,

      runId: 'run-1',

      mode: 'REPLAY',

      step: 3,

      eventType: 'intervention',

      action: null,

      target: null,

      policyDecision: null,

      result: {
        kind: 'handoff_evidence',

        sessionId: 'session-1',

        interventionId: 'intervention-1',

        source: 'REPLAY',

        checkpoint,

        sessionState:
          checkpoint === 'BEFORE_INTERVENTION' || checkpoint === 'AUTOMATION_RESUMED'
            ? 'ACTIVE'
            : 'PAUSED',

        sessionOwner:
          checkpoint === 'HUMAN_CONTROL' || checkpoint === 'HUMAN_RESOLUTION' ? 'HUMAN' : 'REPLAY',

        screenshotCaptured: true,
      },

      evidenceRefs: [reference],
    });
  });

  await writeFile(
    join(runDirectory, 'events.jsonl'),

    `${events.join('\n')}\n`,

    'utf8',
  );

  for (let index = 1; index <= 4; index += 1) {
    await writeFile(
      join(runDirectory, 'screenshots', `screenshot-${String(index).padStart(4, '0')}.png`),

      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, index]),
    );
  }
}

describe('human handoff evidence package', () => {
  it('freezes one correlated reviewer package with four handoff screenshots and checksums', async () => {
    const root = await temporaryRoot();

    const evidenceRoot = join(root, 'evidence');

    const outputDirectory = join(evidenceRoot, 'human-handoff');

    await sourceEvidence(evidenceRoot);

    const frozen = await freezeHumanHandoffEvidencePackage({
      sourceEvidenceRoot: evidenceRoot,

      runId: 'run-1',

      outputDirectory,

      intervention: intervention(),
    });

    expect(frozen).toMatchObject({
      runId: 'run-1',

      sessionId: 'session-1',

      interventionId: 'intervention-1',
    });

    expect(frozen.screenshots).toEqual([
      'screenshot-0001.png',

      'screenshot-0002.png',

      'screenshot-0003.png',

      'screenshot-0004.png',
    ]);

    const readme = await readFile(
      join(outputDirectory, 'README.md'),

      'utf8',
    );

    expect(readme).toContain('Run ID: `run-1`');

    expect(readme).toContain('Session ID: `session-1`');

    expect(readme).toContain('Intervention ID: `intervention-1`');

    expect(readme).toContain('HUMAN acquired control at `2026-09-23T20:00:01.000Z`');

    expect(readme).toContain('Human completed the required manual action.');

    expect(readme).toContain('Automation control was restored at `2026-09-23T20:00:03.000Z`');

    expect(readme).toContain('persisted terminal run status is `success`');

    const checksums = await readFile(
      join(outputDirectory, 'SHA256SUMS.txt'),

      'utf8',
    );

    expect(checksums).toContain('README.md');

    expect(checksums).toContain('intervention.json');

    expect(checksums).toContain('events.jsonl');

    expect(checksums).toContain('result.json');

    expect(checksums).toContain('screenshots/screenshot-0001.png');

    expect(checksums).not.toContain('SHA256SUMS.txt');
  });

  it('fails closed when handoff events do not preserve the intervention session', async () => {
    const root = await temporaryRoot();

    const evidenceRoot = join(root, 'evidence');

    const outputDirectory = join(evidenceRoot, 'human-handoff');

    await sourceEvidence(evidenceRoot);

    const eventsPath = join(evidenceRoot, 'run-1', 'events.jsonl');

    const contents = await readFile(eventsPath, 'utf8');

    await writeFile(
      eventsPath,

      contents.replace('"sessionId":"session-1"', '"sessionId":"different-session"'),

      'utf8',
    );

    await expect(
      freezeHumanHandoffEvidencePackage({
        sourceEvidenceRoot: evidenceRoot,

        runId: 'run-1',

        outputDirectory,

        intervention: intervention(),
      }),
    ).rejects.toThrow('BEFORE_INTERVENTION');
  });
});
