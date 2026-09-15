import { parseDiscoveryDecision } from '../../src/discovery/decision.js';

import type { DiscoveryDecision } from '../../src/discovery/decision.js';
import type {
  DiscoveryDecisionModel,
  DiscoveryModelInput,
} from '../../src/discovery/model/discovery-decision-model.js';

export class ScriptedDiscoveryModelExhaustedError extends Error {
  constructor(readonly requestedCall: number) {
    super(`Scripted discovery model exhausted before call ${requestedCall}`);
    this.name = 'ScriptedDiscoveryModelExhaustedError';
  }
}

/**
 * Deterministic test model.
 *
 * It returns validated decisions in the supplied order and never creates an
 * OpenAI client or performs a network request.
 */
export class ScriptedDiscoveryDecisionModel implements DiscoveryDecisionModel {
  readonly inputs: DiscoveryModelInput[] = [];

  private readonly decisions: readonly DiscoveryDecision[];
  private cursor = 0;

  constructor(decisions: readonly DiscoveryDecision[]) {
    this.decisions = Object.freeze(
      decisions.map((decision) => Object.freeze(parseDiscoveryDecision(decision))),
    );
  }

  get calls(): number {
    return this.inputs.length;
  }

  get remaining(): number {
    return this.decisions.length - this.cursor;
  }

  decide(input: DiscoveryModelInput): Promise<DiscoveryDecision> {
    const decision = this.decisions[this.cursor];

    if (decision === undefined) {
      return Promise.reject(new ScriptedDiscoveryModelExhaustedError(this.cursor + 1));
    }

    this.inputs.push(input);
    this.cursor += 1;

    return Promise.resolve(decision);
  }
}
