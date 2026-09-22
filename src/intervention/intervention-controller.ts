import type { CoordinatedRunContext } from '../runtime/index.js';
import type { ActiveSessionOwner, SessionOwner } from '../session/index.js';

import type {
  AcquireInterventionInput,
  CreateInterventionInput,
  InterventionManager,
} from './intervention-manager.js';

import type { InterventionRequest } from './intervention-types.js';

export interface CreateAndPauseInterventionInput extends Omit<
  CreateInterventionInput,
  'sessionId'
> {
  context: CoordinatedRunContext<unknown>;

  evidenceRefs?: InterventionRequest['evidenceRefs'];
}

export interface AcquireHumanControlInput {
  interventionId: string;

  context: CoordinatedRunContext<unknown>;

  acquisitionId: string;

  operatorId?: string;
}

export class InterventionController {
  constructor(private readonly manager: InterventionManager) {}

  async createAndPause(input: CreateAndPauseInterventionInput): Promise<InterventionRequest> {
    const owner = this.requireAutomationOwner(input.context.sessionManager.owner);

    const intervention = await this.manager.create({
      id: input.id,

      sessionId: input.context.sessionManager.sessionId,

      source: input.source,

      ...(input.capabilityId === undefined
        ? {}
        : {
            capabilityId: input.capabilityId,
          }),

      ...(input.capabilityVersion === undefined
        ? {}
        : {
            capabilityVersion: input.capabilityVersion,
          }),

      ...(input.goal === undefined
        ? {}
        : {
            goal: input.goal,
          }),

      ...(input.stepId === undefined
        ? {}
        : {
            stepId: input.stepId,
          }),

      reasonCode: input.reasonCode,

      reason: input.reason,

      observedState: input.observedState,

      evidenceRefs: input.evidenceRefs ?? [],

      ...(input.createdAt === undefined
        ? {}
        : {
            createdAt: input.createdAt,
          }),
    });

    /*
     * Persistence happens before pausing.
     * An unpersisted handoff must never leave
     * automation suspended without a record.
     */
    input.context.sessionManager.pause(owner);

    await this.manager.transition(intervention.id, 'WAITING_FOR_HUMAN');

    return (await this.manager.get(intervention.id)).request;
  }

  async acquireHumanControl(input: AcquireHumanControlInput): Promise<InterventionRequest> {
    const stored = await this.manager.get(input.interventionId);

    if (stored.request.sessionId !== input.context.sessionManager.sessionId) {
      throw new Error(`Intervention ${input.interventionId} is bound to another session`);
    }

    if (stored.request.status !== 'WAITING_FOR_HUMAN') {
      throw new Error(
        `Intervention ${input.interventionId} must be WAITING_FOR_HUMAN before human acquisition`,
      );
    }

    const expectedOwner = this.sourceAutomationOwner(stored.request.source);

    const session = input.context.sessionManager;

    if (session.state !== 'PAUSED') {
      throw new Error(`Human acquisition requires PAUSED session state; received ${session.state}`);
    }

    if (session.owner !== expectedOwner) {
      throw new Error(
        `Expected ${expectedOwner} ownership before human acquisition; received ${session.owner}`,
      );
    }

    const acquisitionInput: AcquireInterventionInput = {
      interventionId: input.interventionId,

      sessionId: session.sessionId,

      acquisitionId: input.acquisitionId,

      ...(input.operatorId === undefined
        ? {}
        : {
            operatorId: input.operatorId,
          }),
    };

    /*
     * Acquire persistent intervention ownership first.
     *
     * This gives us the exclusive lifecycle claim before
     * handing the live BrowserContext/Page to HUMAN.
     */
    await this.manager.acquire(acquisitionInput);

    session.transferOwnership(expectedOwner, 'HUMAN');

    return (await this.manager.get(input.interventionId)).request;
  }

  async markHumanWorkInProgress(interventionId: string): Promise<InterventionRequest> {
    const stored = await this.manager.markInProgress(interventionId);

    return stored.request;
  }

  private sourceAutomationOwner(source: InterventionRequest['source']): ActiveSessionOwner {
    return source;
  }

  private requireAutomationOwner(owner: SessionOwner): 'DISCOVERY' | 'REPLAY' {
    if (owner !== 'DISCOVERY' && owner !== 'REPLAY') {
      throw new Error(
        `Intervention handoff requires automation ownership; current owner is ${owner}`,
      );
    }

    return owner;
  }
}
