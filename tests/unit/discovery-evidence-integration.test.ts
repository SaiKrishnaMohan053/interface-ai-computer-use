import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { EvidenceRecorder } from '../../src/evidence/index.js';

const PNG_BYTES = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe('Discovery evidence integration', () => {
  it('persists sanitized run metadata, events, screenshots, and final result', async () => {
    const evidenceRoot = await mkdtemp(join(tmpdir(), 'discovery-evidence-'));

    temporaryRoots.push(evidenceRoot);

    const recorder = await EvidenceRecorder.startRun({
      runId: 'discovery-lookup-savings-balance',
      mode: 'DISCOVERY',
      evidenceRoot,
      startedAt: '2026-09-14T20:00:00.000Z',
      metadata: {
        goal: "Read Alex Morgan's Savings balance",
        apiKey: 'must-not-be-persisted',
      },
    });

    const screenshot = await recorder.captureScreenshot({
      step: 2,
      bytes: PNG_BYTES,
      capturedAt: '2026-09-14T20:00:01.000Z',
      dataHandling: 'SYNTHETIC_FIXTURE_ONLY',
    });

    await recorder.recordEvent({
      step: 2,
      eventType: 'discovery_trace',
      result: {
        kind: 'runtime_event',
        status: 'success',
        summary: 'Savings balance was read',
      },
      evidenceRefs: [screenshot],
    });

    await recorder.finishRun({
      status: 'success',
      finishedAt: '2026-09-14T20:00:02.000Z',
      result: {
        outputs: {
          savingsBalance: '$12,840.50',
        },
        accessToken: 'must-not-be-persisted',
      },
    });

    const runDirectory = join(evidenceRoot, 'discovery-lookup-savings-balance');

    const runJson = await readFile(join(runDirectory, 'run.json'), 'utf8');

    const eventsJsonl = await readFile(join(runDirectory, 'events.jsonl'), 'utf8');

    const resultJson = await readFile(join(runDirectory, 'result.json'), 'utf8');

    await expect(
      stat(join(runDirectory, 'screenshots', 'screenshot-0001.png')),
    ).resolves.toMatchObject({
      size: PNG_BYTES.length,
    });

    await expect(stat(join(runDirectory, 'traces'))).resolves.toMatchObject({});

    expect(JSON.parse(runJson)).toMatchObject({
      runId: 'discovery-lookup-savings-balance',
      mode: 'DISCOVERY',
      metadata: {
        goal: "Read Alex Morgan's Savings balance",
        apiKey: '[REDACTED]',
      },
    });

    expect(eventsJsonl).toContain('discovery_trace');

    expect(eventsJsonl).toContain('screenshot-0001.png');

    expect(JSON.parse(resultJson)).toMatchObject({
      status: 'success',
      result: {
        outputs: {
          savingsBalance: '$12,840.50',
        },
        accessToken: '[REDACTED]',
      },
      evidenceRefs: [
        {
          kind: 'event_log',
        },
        {
          kind: 'screenshot',
        },
      ],
    });

    expect(`${runJson}${eventsJsonl}${resultJson}`).not.toContain('must-not-be-persisted');
  });

  it('continues to reject raw screenshot and non-synthetic trace persistence', async () => {
    const evidenceRoot = await mkdtemp(join(tmpdir(), 'discovery-evidence-'));

    temporaryRoots.push(evidenceRoot);

    const recorder = await EvidenceRecorder.startRun({
      runId: 'discovery-evidence-safety',
      mode: 'DISCOVERY',
      evidenceRoot,
    });

    expect(() =>
      recorder.captureScreenshot({
        step: 1,
        bytes: PNG_BYTES,
        dataHandling: 'RAW' as never,
      }),
    ).toThrow('Raw screenshot evidence cannot be persisted');

    expect(() =>
      recorder.attachTrace({
        step: 1,
        bytes: Uint8Array.from([0x50, 0x4b]),
        dataHandling: 'RAW' as never,
      }),
    ).toThrow('Playwright traces are restricted to synthetic fixtures');

    await recorder.finishRun({
      status: 'failure',
      result: {
        code: 'APPLICATION_ERROR',
      },
    });
  });
});
