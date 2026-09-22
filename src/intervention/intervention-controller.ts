import type { CoordinatedRunContext } from '../runtime/index.js';
import type { SessionOwner } from '../session/index.js';

import type { CreateInterventionInput, InterventionManager } from './intervention-manager.js';

import type { InterventionRequest } from './intervention-types.js';

export interface CreateAndPauseInterventionInput extends Omit<
  CreateInterventionInput,
  'sessionId'
> {
  context: CoordinatedRunContext<unknown>;

  evidenceRefs?: InterventionRequest['evidenceRefs'];
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
     * Persist intervention first.
     *
     * If persistence fails, automation remains ACTIVE
     * and we have not produced an untracked handoff.
     */
    input.context.sessionManager.pause(owner);

    await this.manager.transition(intervention.id, 'WAITING_FOR_HUMAN');

    return (await this.manager.get(intervention.id)).request;
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
