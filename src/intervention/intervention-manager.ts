import {
  interventionRequestSchema,
  interventionResolutionSchema,
  humanActionRecordSchema,
} from './intervention-types.js';

import type {
  HumanActionRecord,
  InterventionRequest,
  InterventionResolution,
  InterventionStatus,
} from './intervention-types.js';

import {
  assertInterventionTransition,
  isTerminalInterventionStatus,
} from './intervention-state-machine.js';

import { InterventionError, InterventionNotFoundError } from './intervention-errors.js';

import type { InterventionStore, StoredIntervention } from './intervention-store.js';

export interface CreateInterventionInput {
  id: string;

  sessionId: string;

  source: InterventionRequest['source'];

  capabilityId?: string;
  capabilityVersion?: string;

  goal?: string;

  stepId?: string;

  reasonCode: InterventionRequest['reasonCode'];

  reason: string;

  observedState: string;

  evidenceRefs?: InterventionRequest['evidenceRefs'];

  createdAt?: string;
}

export interface InterventionManagerDependencies {
  store: InterventionStore;

  now?: () => string;
}

export class InterventionManager {
  private readonly store: InterventionStore;

  private readonly now: () => string;

  constructor(dependencies: InterventionManagerDependencies) {
    this.store = dependencies.store;

    this.now =
      dependencies.now ??
      (() => {
        return new Date().toISOString();
      });
  }

  async create(input: CreateInterventionInput): Promise<InterventionRequest> {
    const request = interventionRequestSchema.parse({
      id: input.id,

      sessionId: input.sessionId,

      source: input.source,

      capabilityId: input.capabilityId,
      capabilityVersion: input.capabilityVersion,

      goal: input.goal,

      stepId: input.stepId,

      reasonCode: input.reasonCode,

      reason: input.reason,

      observedState: input.observedState,

      evidenceRefs: input.evidenceRefs ?? [],

      createdAt: input.createdAt ?? this.now(),

      status: 'REQUESTED',
    });

    await this.store.create({
      request,
      humanActions: [],
    });

    return request;
  }

  async get(interventionId: string): Promise<StoredIntervention> {
    const record = await this.store.get(interventionId);

    if (record === undefined) {
      throw new InterventionNotFoundError(interventionId);
    }

    return record;
  }

  async transition(
    interventionId: string,
    nextStatus: InterventionStatus,
  ): Promise<InterventionRequest> {
    const record = await this.get(interventionId);

    assertInterventionTransition(record.request.status, nextStatus);

    const updatedRequest = interventionRequestSchema.parse({
      ...record.request,
      status: nextStatus,
    });

    await this.store.update({
      ...record,
      request: updatedRequest,
    });

    return updatedRequest;
  }

  async addEvidenceReferences(
    interventionId: string,
    evidenceRefs: InterventionRequest['evidenceRefs'],
  ): Promise<InterventionRequest> {
    const record = await this.get(interventionId);

    if (isTerminalInterventionStatus(record.request.status)) {
      throw new InterventionError(
        'INTERVENTION_ALREADY_TERMINAL',
        `Cannot attach evidence to terminal intervention ${interventionId}`,
        {
          interventionId,
          status: record.request.status,
        },
      );
    }

    const mergedEvidence = this.mergeEvidenceReferences(record.request.evidenceRefs, evidenceRefs);

    const updatedRequest = interventionRequestSchema.parse({
      ...record.request,
      evidenceRefs: mergedEvidence,
    });

    await this.store.update({
      ...record,
      request: updatedRequest,
    });

    return updatedRequest;
  }

  async recordHumanAction(input: HumanActionRecord): Promise<HumanActionRecord> {
    const action = humanActionRecordSchema.parse(input);

    const record = await this.get(action.interventionId);

    if (record.request.sessionId !== action.sessionId) {
      throw new InterventionError(
        'INVALID_INTERVENTION',
        'Human action session does not match intervention session',
        {
          interventionId: action.interventionId,
          expectedSessionId: record.request.sessionId,
          actualSessionId: action.sessionId,
        },
      );
    }

    if (isTerminalInterventionStatus(record.request.status)) {
      throw new InterventionError(
        'INTERVENTION_ALREADY_TERMINAL',
        `Cannot record human action for terminal intervention ${action.interventionId}`,
        {
          interventionId: action.interventionId,
          status: record.request.status,
        },
      );
    }

    await this.store.update({
      ...record,

      humanActions: [...record.humanActions, action],
    });

    return action;
  }

  async resolve(
    interventionId: string,
    resolution: InterventionResolution,
  ): Promise<StoredIntervention> {
    const parsedResolution = interventionResolutionSchema.parse(resolution);

    if (parsedResolution.kind !== 'RESUME') {
      throw new InterventionError(
        'INTERVENTION_RESOLUTION_INVALID',
        'resolve() requires a RESUME resolution',
        {
          interventionId,
          resolutionKind: parsedResolution.kind,
        },
      );
    }

    const record = await this.get(interventionId);

    assertInterventionTransition(record.request.status, 'RESOLVED');

    const updatedRequest = interventionRequestSchema.parse({
      ...record.request,

      status: 'RESOLVED',

      evidenceRefs: this.mergeEvidenceReferences(
        record.request.evidenceRefs,
        parsedResolution.evidenceRefs,
      ),
    });

    const updatedRecord: StoredIntervention = {
      ...record,

      request: updatedRequest,

      resolution: parsedResolution,
    };

    await this.store.update(updatedRecord);

    return updatedRecord;
  }

  async abort(
    interventionId: string,
    resolution: InterventionResolution,
  ): Promise<StoredIntervention> {
    const parsedResolution = interventionResolutionSchema.parse(resolution);

    if (parsedResolution.kind !== 'ABORT') {
      throw new InterventionError(
        'INTERVENTION_RESOLUTION_INVALID',
        'abort() requires an ABORT resolution',
        {
          interventionId,
          resolutionKind: parsedResolution.kind,
        },
      );
    }

    const record = await this.get(interventionId);

    assertInterventionTransition(record.request.status, 'ABORTED');

    const updatedRequest = interventionRequestSchema.parse({
      ...record.request,

      status: 'ABORTED',

      evidenceRefs: this.mergeEvidenceReferences(
        record.request.evidenceRefs,
        parsedResolution.evidenceRefs,
      ),
    });

    const updatedRecord: StoredIntervention = {
      ...record,

      request: updatedRequest,

      resolution: parsedResolution,
    };

    await this.store.update(updatedRecord);

    return updatedRecord;
  }

  async expire(interventionId: string): Promise<InterventionRequest> {
    const record = await this.get(interventionId);

    assertInterventionTransition(record.request.status, 'EXPIRED');

    const updatedRequest = interventionRequestSchema.parse({
      ...record.request,

      status: 'EXPIRED',
    });

    await this.store.update({
      ...record,
      request: updatedRequest,
    });

    return updatedRequest;
  }

  private mergeEvidenceReferences(
    existing: InterventionRequest['evidenceRefs'],
    additional: InterventionRequest['evidenceRefs'],
  ): InterventionRequest['evidenceRefs'] {
    const unique = new Map<string, InterventionRequest['evidenceRefs'][number]>();

    for (const reference of [...existing, ...additional]) {
      unique.set(JSON.stringify(reference), reference);
    }

    return [...unique.values()];
  }
}
