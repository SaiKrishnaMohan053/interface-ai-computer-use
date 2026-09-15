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

const textMatch = (value: string) => ({
  value,
  mode: 'exact' as const,
  caseSensitive: false,
});

/**
 * Assignment demo script.
 * Hard-coded workflow knowledge is test-only.
 */
export function createSavingsBalanceDiscoveryScript(): readonly DiscoveryDecision[] {
  return [
    {
      kind: 'type',

      target: {
        description: 'Member name input',

        strategies: [
          {
            kind: 'label',
            label: textMatch('Member Name'),
          },
        ],

        cardinality: 'exactly-one',
      },

      text: 'Alex Morgan',
      mode: 'replace',

      reason: 'Enter the member name from the test goal',
    },

    {
      kind: 'click',

      target: {
        description: 'Member search button',

        strategies: [
          {
            kind: 'role-name',
            role: 'button',
            name: textMatch('Search'),
          },
        ],

        cardinality: 'exactly-one',
      },

      reason: 'Run the member lookup',
    },

    {
      kind: 'click',

      target: {
        description: 'Accounts link',

        strategies: [
          {
            kind: 'role-name',
            role: 'link',
            name: textMatch('Accounts'),
          },
        ],

        cardinality: 'exactly-one',
      },

      reason: 'Open the observed accounts page',
    },

    {
      kind: 'read',

      target: {
        description: 'Savings current balance',

        strategies: [
          {
            kind: 'structural',

            query: {
              kind: 'table-cell',

              table: {
                name: textMatch('Accounts'),
              },

              row: {
                columnHeader: textMatch('Account Type'),

                value: textMatch('Savings'),
              },

              column: {
                header: textMatch('Current Balance'),
              },
            },
          },
        ],

        cardinality: 'exactly-one',
      },

      source: 'text',
      saveAs: 'savingsBalance',

      reason: 'Read the Savings row current balance',
    },

    {
      kind: 'complete',

      summary: 'Savings balance was read from the observed Accounts table',

      outputs: {
        savingsBalance: '$12,840.50',
      },
    },
  ];
}

export function createKnownDialogSavingsBalanceScript(): readonly DiscoveryDecision[] {
  return [
    {
      kind: 'click',

      target: {
        description: 'Known service notice Continue link',

        strategies: [
          {
            kind: 'role-name',
            role: 'link',
            name: textMatch('Continue'),
          },
        ],

        cardinality: 'exactly-one',
      },

      reason: 'Continue through the known safe demonstration notice',
    },

    ...createSavingsBalanceDiscoveryScript(),
  ];
}
