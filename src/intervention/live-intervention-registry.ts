import type { CoordinatedRunContext } from '../runtime/index.js';

export interface LiveInterventionRegistration {
  interventionId: string;

  context: CoordinatedRunContext<unknown>;
}

export class LiveInterventionRegistry {
  private readonly registrations = new Map<string, CoordinatedRunContext<unknown>>();

  register(registration: LiveInterventionRegistration): void {
    const interventionId = registration.interventionId.trim();

    if (interventionId.length === 0) {
      throw new Error('interventionId must not be empty');
    }

    if (this.registrations.has(interventionId)) {
      throw new Error(`Live intervention already registered: ${interventionId}`);
    }

    this.registrations.set(interventionId, registration.context);
  }

  get(interventionId: string): CoordinatedRunContext<unknown> {
    const context = this.registrations.get(interventionId);

    if (context === undefined) {
      throw new Error(`No live intervention context registered: ${interventionId}`);
    }

    return context;
  }

  has(interventionId: string): boolean {
    return this.registrations.has(interventionId);
  }

  remove(interventionId: string): boolean {
    return this.registrations.delete(interventionId);
  }

  clear(): void {
    this.registrations.clear();
  }

  listIds(): readonly string[] {
    return [...this.registrations.keys()];
  }
}
