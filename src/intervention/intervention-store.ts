import type {
  HumanActionRecord,
  InterventionRequest,
  InterventionResolution,
} from './intervention-types.js';

export interface StoredIntervention {
  request: InterventionRequest;

  resolution?: InterventionResolution;

  humanActions: HumanActionRecord[];
}

export interface InterventionStore {
  create(record: StoredIntervention): Promise<void>;

  get(interventionId: string): Promise<StoredIntervention | undefined>;

  update(record: StoredIntervention): Promise<void>;
}

function cloneRecord(record: StoredIntervention): StoredIntervention {
  return structuredClone(record);
}

export class InMemoryInterventionStore implements InterventionStore {
  private readonly records = new Map<string, StoredIntervention>();

  create(record: StoredIntervention): Promise<void> {
    if (this.records.has(record.request.id)) {
      return Promise.reject(new Error(`Intervention already exists: ${record.request.id}`));
    }

    this.records.set(record.request.id, cloneRecord(record));

    return Promise.resolve();
  }

  get(interventionId: string): Promise<StoredIntervention | undefined> {
    const record = this.records.get(interventionId);

    return Promise.resolve(record === undefined ? undefined : cloneRecord(record));
  }

  update(record: StoredIntervention): Promise<void> {
    if (!this.records.has(record.request.id)) {
      return Promise.reject(new Error(`Intervention does not exist: ${record.request.id}`));
    }

    this.records.set(record.request.id, cloneRecord(record));

    return Promise.resolve();
  }
}
