import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FileSystemInterventionStore } from '../../src/intervention/index.js';

import type { StoredIntervention } from '../../src/intervention/index.js';

const NOW = '2026-09-21T22:15:00.000Z';

const temporaryDirectories: string[] = [];

async function createStore(): Promise<{
  store: FileSystemInterventionStore;
  rootDirectory: string;
}> {
  const rootDirectory = await mkdtemp(resolve(tmpdir(), 'interface-ai-interventions-'));

  temporaryDirectories.push(rootDirectory);

  return {
    store: new FileSystemInterventionStore({
      rootDirectory,
    }),
    rootDirectory,
  };
}

function createRecord(overrides: Partial<StoredIntervention> = {}): StoredIntervention {
  return {
    request: {
      id: 'intervention-1',

      sessionId: 'session-1',

      source: 'REPLAY',

      capabilityId: 'prepare_new_savings_subaccount',

      capabilityVersion: '1.0.0',

      stepId: 'confirm-create',

      reasonCode: 'HUMAN_APPROVAL_REQUIRED',

      reason: 'Final create action requires human involvement',

      observedState: 'Sub-account review screen',

      evidenceRefs: [],

      createdAt: NOW,

      status: 'REQUESTED',
    },

    humanActions: [],

    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe('FileSystemInterventionStore', () => {
  it('persists and reloads an intervention', async () => {
    const { store } = await createStore();

    const record = createRecord();

    await store.create(record);

    const loaded = await store.get('intervention-1');

    expect(loaded).toEqual(record);
  });

  it('returns undefined for an unknown intervention', async () => {
    const { store } = await createStore();

    await expect(store.get('missing-intervention')).resolves.toBeUndefined();
  });

  it('does not allow create to overwrite an existing intervention', async () => {
    const { store } = await createStore();

    const record = createRecord();

    await store.create(record);

    await expect(store.create(record)).rejects.toBeInstanceOf(Error);
  });

  it('updates an existing intervention', async () => {
    const { store } = await createStore();

    const record = createRecord();

    await store.create(record);

    await store.update({
      ...record,

      request: {
        ...record.request,

        status: 'WAITING_FOR_HUMAN',
      },
    });

    const loaded = await store.get('intervention-1');

    expect(loaded?.request.status).toBe('WAITING_FOR_HUMAN');
  });

  it('rejects update for a missing intervention', async () => {
    const { store } = await createStore();

    await expect(store.update(createRecord())).rejects.toThrow(
      'Intervention does not exist: intervention-1',
    );
  });

  it('persists human action audit records', async () => {
    const { store } = await createStore();

    const record = createRecord();

    await store.create(record);

    await store.update({
      ...record,

      humanActions: [
        {
          actionId: 'human-action-1',

          interventionId: 'intervention-1',

          sessionId: 'session-1',

          kind: 'MANUAL_STEP',

          summary: 'Human completed the confirmation step',

          occurredAt: NOW,

          evidenceRefs: [],

          details: {},
        },
      ],
    });

    const loaded = await store.get('intervention-1');

    expect(loaded?.humanActions).toHaveLength(1);

    expect(loaded?.humanActions[0]?.kind).toBe('MANUAL_STEP');
  });

  it('persists resolution metadata', async () => {
    const { store } = await createStore();

    const record = createRecord();

    await store.create(record);

    await store.update({
      ...record,

      request: {
        ...record.request,

        status: 'RESOLVED',
      },

      resolution: {
        kind: 'RESUME',

        code: 'MANUAL_ACTION_COMPLETED',

        summary: 'Human completed the required manual action',

        resolvedAt: NOW,

        evidenceRefs: [],
      },
    });

    const loaded = await store.get('intervention-1');

    expect(loaded?.resolution?.kind).toBe('RESUME');

    expect(loaded?.request.status).toBe('RESOLVED');
  });

  it('does not use the raw intervention id as a filesystem path', async () => {
    const { store, rootDirectory } = await createStore();

    const record = createRecord({
      request: {
        ...createRecord().request,

        id: '../unsafe/path/intervention',
      },
    });

    await store.create(record);

    const loaded = await store.get('../unsafe/path/intervention');

    expect(loaded?.request.id).toBe('../unsafe/path/intervention');

    await expect(
      readFile(
        resolve(rootDirectory, '..', 'unsafe', 'path', 'intervention', 'intervention.json'),
        'utf8',
      ),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('does not persist undeclared browser handles', async () => {
    const { store } = await createStore();

    const invalidRecord = {
      ...createRecord(),

      page: {
        browserHandle: 'should-never-persist',
      },
    };

    await expect(
      store.create(invalidRecord as unknown as StoredIntervention),
    ).rejects.toBeDefined();
  });
});
