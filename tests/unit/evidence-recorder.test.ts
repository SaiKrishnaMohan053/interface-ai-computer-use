import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startRun } from '../../src/evidence/index.js';

const directories: string[] = [];

const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);

const zipBytes = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1]);

async function createRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'evidence-recorder-'));

  directories.push(directory);

  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) =>
      rm(path, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe('EvidenceRecorder', () => {
  it('creates evidence/<run-id>/ and redacts every JSONL event before persistence', async () => {
    const evidenceRoot = await createRoot();

    const recorder = await startRun({
      runId: 'run-redaction',
      mode: 'DISCOVERY',
      evidenceRoot,
      metadata: {
        memberId: 'start-secret',
        goal: 'Read balance',
      },
    });

    await recorder.recordEvent({
      step: 1,
      eventType: 'action',
      action: {
        kind: 'type',
        password: 'password-secret',
      },
      target: {
        description: 'Member ID: 12345',
      },
      policyDecision: {
        decision: 'ALLOW',
        authorization: 'Bearer auth-secret',
      },
      result: {
        currentBalance: '$12,840.50',
        nested: {
          token: 'token-secret',
        },
      },
    });

    await recorder.finishRun({
      status: 'success',
      result: {
        memberId: 'finish-secret',
      },
    });

    const contents = await readFile(join(evidenceRoot, 'run-redaction', 'events.jsonl'), 'utf8');

    const events = contents
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(events).toHaveLength(3);

    expect(events[1]).toMatchObject({
      runId: 'run-redaction',
      mode: 'DISCOVERY',
      step: 1,
      eventType: 'action',
    });

    for (const secret of [
      'start-secret',
      'password-secret',
      '12345',
      'auth-secret',
      'token-secret',
      'finish-secret',
    ]) {
      expect(contents).not.toContain(secret);
    }

    expect(contents).toContain('$12,840.50');
  });

  it('captures declared-safe PNG evidence and records its reference', async () => {
    const evidenceRoot = await createRoot();

    const recorder = await startRun({
      runId: 'run-screenshot',
      mode: 'REPLAY',
      evidenceRoot,
    });

    const reference = await recorder.captureScreenshot({
      step: 2,
      bytes: pngBytes,
      dataHandling: 'REDACTED_BEFORE_CAPTURE',
    });

    const summary = await recorder.finishRun({
      status: 'failure',
      result: {
        code: 'ACTION_FAILED',
      },
    });

    expect(reference).toMatchObject({
      runId: 'run-screenshot',
      kind: 'screenshot',
      relativePath: 'run-screenshot/screenshots/screenshot-0001.png',
      mediaType: 'image/png',
    });

    expect(await readFile(join(evidenceRoot, reference.relativePath))).toEqual(
      Buffer.from(pngBytes),
    );

    expect(summary.evidenceRefs).toContainEqual(reference);
  });

  it('attaches only synthetic Playwright ZIP traces', async () => {
    const evidenceRoot = await createRoot();

    const recorder = await startRun({
      runId: 'run-trace',
      mode: 'DISCOVERY',
      evidenceRoot,
    });

    const reference = await recorder.attachTrace({
      step: 3,
      bytes: zipBytes,
      dataHandling: 'SYNTHETIC_FIXTURE_ONLY',
    });

    expect(reference.relativePath).toBe('run-trace/traces/trace-0001.zip');

    expect(await readFile(join(evidenceRoot, reference.relativePath))).toEqual(
      Buffer.from(zipBytes),
    );

    await recorder.finishRun({
      status: 'success',
      result: null,
    });
  });

  it('rejects raw binary declarations, invalid files and unsafe run IDs', async () => {
    const evidenceRoot = await createRoot();

    await expect(
      startRun({
        runId: '../escape',
        mode: 'DISCOVERY',
        evidenceRoot,
      }),
    ).rejects.toThrow('Invalid evidence runId');

    const recorder = await startRun({
      runId: 'safe-run',
      mode: 'DISCOVERY',
      evidenceRoot,
    });

    expect(() =>
      recorder.captureScreenshot({
        step: 1,
        bytes: pngBytes,
        dataHandling: 'RAW' as never,
      }),
    ).toThrow('Raw screenshot evidence cannot be persisted');

    expect(() =>
      recorder.attachTrace({
        step: 1,
        bytes: zipBytes,
        dataHandling: 'RAW' as never,
      }),
    ).toThrow('Playwright traces are restricted to synthetic fixtures');

    expect(() =>
      recorder.captureScreenshot({
        step: 1,
        bytes: Uint8Array.from([1, 2, 3]),
        dataHandling: 'SYNTHETIC_FIXTURE_ONLY',
      }),
    ).toThrow('Screenshot evidence must contain PNG bytes');

    await recorder.finishRun({
      status: 'failure',
      result: null,
    });
  });

  it('serializes concurrent events and rejects writes after finish', async () => {
    const evidenceRoot = await createRoot();

    const recorder = await startRun({
      runId: 'run-order',
      mode: 'HUMAN',
      evidenceRoot,
    });

    await Promise.all(
      [1, 2, 3].map((step) =>
        recorder.recordEvent({
          step,
          eventType: 'human_action',
          result: {
            step,
          },
        }),
      ),
    );

    const summary = await recorder.finishRun({
      status: 'intervention_required',
      result: null,
    });

    expect(summary.durationMs).toBeGreaterThanOrEqual(0);

    expect(() =>
      recorder.recordEvent({
        step: 4,
        eventType: 'action',
        result: null,
      }),
    ).toThrow('Evidence run is finished');

    const contents = await readFile(join(evidenceRoot, 'run-order', 'events.jsonl'), 'utf8');

    const steps = contents
      .trim()
      .split('\n')
      .map(
        (line) =>
          JSON.parse(line) as {
            step: number;
          },
      )
      .map((event) => event.step);

    expect(steps).toEqual([0, 1, 2, 3, 0]);
  });
});
