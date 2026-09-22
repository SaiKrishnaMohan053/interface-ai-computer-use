import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

import { sanitizeForPersistence, serializeSanitized } from '../security/index.js';

import {
  humanActionRecordSchema,
  interventionAcquisitionSchema,
  interventionRequestSchema,
  interventionResolutionSchema,
} from './intervention-types.js';

import type {
  HumanActionRecord,
  InterventionAcquisition,
  InterventionRequest,
  InterventionResolution,
} from './intervention-types.js';

export interface StoredIntervention {
  request: InterventionRequest;

  acquisition?: InterventionAcquisition | undefined;

  resolution?: InterventionResolution | undefined;

  humanActions: HumanActionRecord[];
}

export const storedInterventionSchema = z
  .object({
    request: interventionRequestSchema,

    acquisition: interventionAcquisitionSchema.optional(),

    resolution: interventionResolutionSchema.optional(),

    humanActions: z.array(humanActionRecordSchema),
  })
  .strict();

export interface InterventionStore {
  create(record: StoredIntervention): Promise<void>;

  get(interventionId: string): Promise<StoredIntervention | undefined>;

  list(): Promise<readonly StoredIntervention[]>;

  update(record: StoredIntervention): Promise<void>;
}

function cloneRecord(record: StoredIntervention): StoredIntervention {
  return structuredClone(record);
}

function sortRecords(records: readonly StoredIntervention[]): StoredIntervention[] {
  return [...records].sort((left, right) => {
    const byCreatedAt = left.request.createdAt.localeCompare(right.request.createdAt);

    if (byCreatedAt !== 0) {
      return byCreatedAt;
    }

    return left.request.id.localeCompare(right.request.id);
  });
}

export class InMemoryInterventionStore implements InterventionStore {
  private readonly records = new Map<string, StoredIntervention>();

  create(record: StoredIntervention): Promise<void> {
    if (this.records.has(record.request.id)) {
      return Promise.reject(new Error(`Intervention already exists: ${record.request.id}`));
    }

    const parsed = storedInterventionSchema.parse(record);

    this.records.set(record.request.id, cloneRecord(parsed));

    return Promise.resolve();
  }

  get(interventionId: string): Promise<StoredIntervention | undefined> {
    const record = this.records.get(interventionId);

    return Promise.resolve(record === undefined ? undefined : cloneRecord(record));
  }

  list(): Promise<readonly StoredIntervention[]> {
    return Promise.resolve(sortRecords([...this.records.values()].map(cloneRecord)));
  }

  update(record: StoredIntervention): Promise<void> {
    if (!this.records.has(record.request.id)) {
      return Promise.reject(new Error(`Intervention does not exist: ${record.request.id}`));
    }

    const parsed = storedInterventionSchema.parse(record);

    this.records.set(record.request.id, cloneRecord(parsed));

    return Promise.resolve();
  }
}

export interface FileSystemInterventionStoreOptions {
  rootDirectory?: string;
}

export class FileSystemInterventionStore implements InterventionStore {
  readonly rootDirectory: string;

  constructor(options: FileSystemInterventionStoreOptions = {}) {
    this.rootDirectory = resolve(options.rootDirectory ?? '.runtime/interventions');
  }

  async create(record: StoredIntervention): Promise<void> {
    const parsed = storedInterventionSchema.parse(record);

    await mkdir(this.rootDirectory, {
      recursive: true,
    });

    const directory = this.interventionDirectory(parsed.request.id);

    /*
     * recursive:false intentionally fails if this
     * intervention already exists. We never silently
     * overwrite create().
     */
    await mkdir(directory);

    try {
      await writeFile(this.interventionPath(parsed.request.id), this.serialize(parsed), {
        encoding: 'utf8',
        flag: 'wx',
      });
    } catch (error) {
      await rm(directory, {
        recursive: true,
        force: true,
      });

      throw error;
    }
  }

  async get(interventionId: string): Promise<StoredIntervention | undefined> {
    try {
      const contents = await readFile(this.interventionPath(interventionId), 'utf8');

      const parsedJson: unknown = JSON.parse(contents);

      return storedInterventionSchema.parse(parsedJson);
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return undefined;
      }

      throw error;
    }
  }

  async list(): Promise<readonly StoredIntervention[]> {
    let entries;

    try {
      entries = await readdir(this.rootDirectory, {
        withFileTypes: true,
      });
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return [];
      }

      throw error;
    }

    const records: StoredIntervention[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const path = resolve(this.rootDirectory, entry.name, 'intervention.json');

      try {
        const contents = await readFile(path, 'utf8');

        const parsedJson: unknown = JSON.parse(contents);

        records.push(storedInterventionSchema.parse(parsedJson));
      } catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT') {
          continue;
        }

        throw error;
      }
    }

    return sortRecords(records);
  }

  async update(record: StoredIntervention): Promise<void> {
    const parsed = storedInterventionSchema.parse(record);

    const existing = await this.get(parsed.request.id);

    if (existing === undefined) {
      throw new Error(`Intervention does not exist: ${parsed.request.id}`);
    }

    await writeFile(this.interventionPath(parsed.request.id), this.serialize(parsed), {
      encoding: 'utf8',
      flag: 'w',
    });
  }

  private serialize(record: StoredIntervention): string {
    return serializeSanitized(sanitizeForPersistence(record));
  }

  private interventionDirectory(interventionId: string): string {
    return resolve(this.rootDirectory, this.directoryName(interventionId));
  }

  private interventionPath(interventionId: string): string {
    return resolve(this.interventionDirectory(interventionId), 'intervention.json');
  }

  private directoryName(interventionId: string): string {
    return createHash('sha256').update(interventionId).digest('hex');
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
