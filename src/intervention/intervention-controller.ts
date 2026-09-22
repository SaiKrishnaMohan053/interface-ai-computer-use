import type { CoordinatedRunContext } from '../runtime/index.js';
import type { ActiveSessionOwner, SessionOwner } from '../session/index.js';

import type {
  AcquireInterventionInput,
  CreateInterventionInput,
  InterventionManager,
} from './intervention-manager.js';

import type { LiveInterventionRegistry } from './live-intervention-registry.js';

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
  constructor(
    private readonly manager: InterventionManager,

    private readonly liveRegistry?: LiveInterventionRegistry,
  ) {}

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

    /*
     * The registry is process-local only.
     *
     * It deliberately keeps the live CoordinatedRunContext
     * out of persisted intervention records while allowing
     * the operator control plane to recover the exact
     * SessionManager / BrowserContext / Page later.
     */
    this.liveRegistry?.register({
      interventionId: intervention.id,

      context: input.context,
    });

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

    await this.manager.recordAuditEvent({
      interventionId: input.interventionId,

      type: 'human.acquire_requested',

      actor: 'HUMAN',

      summary: 'Human operator requested control of the paused live session.',

      ...(input.operatorId === undefined
        ? {}
        : {
            operatorId: input.operatorId,
          }),
    });

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

  async recordManualAction(input: {
    interventionId: string;

    summary: string;

    operatorId?: string;

    evidenceRefs?: string[];
  }): Promise<void> {
    const stored = await this.manager.get(input.interventionId);

    if (stored.request.status !== 'ACQUIRED' && stored.request.status !== 'IN_PROGRESS') {
      throw new Error(
        `Manual human action requires ACQUIRED or IN_PROGRESS intervention status; received ${stored.request.status}`,
      );
    }

    await this.manager.recordAuditEvent({
      interventionId: input.interventionId,

      type: 'human.action_performed',

      actor: 'HUMAN',

      summary: input.summary,

      ...(input.operatorId === undefined
        ? {}
        : {
            operatorId: input.operatorId,
          }),

      evidenceRefs: input.evidenceRefs ?? [],
    });
  }

  async resumeAutomation(input: {
    interventionId: string;

    context: CoordinatedRunContext<unknown>;

    operatorId?: string;
  }): Promise<InterventionRequest> {
    const stored = await this.manager.get(input.interventionId);

    this.assertHumanOwnedLiveIntervention(stored.request, input.context);

    await this.manager.recordAuditEvent({
      interventionId: input.interventionId,

      type: 'human.resume_requested',

      actor: 'HUMAN',

      summary: 'Human operator requested automation resume.',

      ...(input.operatorId === undefined
        ? {}
        : {
            operatorId: input.operatorId,
          }),
    });

    const automationOwner = this.sourceAutomationOwner(stored.request.source);

    const session = input.context.sessionManager;

    session.transferOwnership('HUMAN', automationOwner);

    await this.manager.recordAuditEvent({
      interventionId: input.interventionId,

      type: 'human.control_released',

      actor: 'HUMAN',

      summary: `Human operator released control back to ${automationOwner}.`,

      ...(input.operatorId === undefined
        ? {}
        : {
            operatorId: input.operatorId,
          }),
    });

    session.resume(automationOwner);

    await this.manager.recordAuditEvent({
      interventionId: input.interventionId,

      type: 'automation.control_restored',

      actor: 'AUTOMATION',

      summary: `${automationOwner} control restored on the same live session.`,
    });

    const resolved = await this.manager.transition(input.interventionId, 'RESOLVED');

    this.liveRegistry?.remove(input.interventionId);

    return resolved;
  }

  async abortHumanIntervention(input: {
    interventionId: string;

    context: CoordinatedRunContext<unknown>;

    operatorId?: string;
  }): Promise<InterventionRequest> {
    const stored = await this.manager.get(input.interventionId);

    this.assertHumanOwnedLiveIntervention(stored.request, input.context);

    await this.manager.recordAuditEvent({
      interventionId: input.interventionId,

      type: 'human.abort_requested',

      actor: 'HUMAN',

      summary: 'Human operator requested that automation stop.',

      ...(input.operatorId === undefined
        ? {}
        : {
            operatorId: input.operatorId,
          }),
    });

    const session = input.context.sessionManager;

    session.releaseOwnership('HUMAN');

    await this.manager.recordAuditEvent({
      interventionId: input.interventionId,

      type: 'human.control_released',

      actor: 'HUMAN',

      summary: 'Human operator released the live session without restoring automation.',

      ...(input.operatorId === undefined
        ? {}
        : {
            operatorId: input.operatorId,
          }),
    });

    const aborted = await this.manager.transition(input.interventionId, 'ABORTED');

    return aborted;
  }

  private assertHumanOwnedLiveIntervention(
    request: InterventionRequest,
    context: CoordinatedRunContext<unknown>,
  ): void {
    if (request.sessionId !== context.sessionManager.sessionId) {
      throw new Error(`Intervention ${request.id} is bound to another session`);
    }

    if (request.status !== 'ACQUIRED' && request.status !== 'IN_PROGRESS') {
      throw new Error(
        `Human handoff completion requires ACQUIRED or IN_PROGRESS intervention status; received ${request.status}`,
      );
    }

    const session = context.sessionManager;

    if (session.state !== 'PAUSED') {
      throw new Error(
        `Human handoff completion requires PAUSED session state; received ${session.state}`,
      );
    }

    if (session.owner !== 'HUMAN') {
      throw new Error(
        `Human handoff completion requires HUMAN ownership; received ${session.owner}`,
      );
    }
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
