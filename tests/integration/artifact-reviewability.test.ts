import { readFile } from 'node:fs/promises';

import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  parseCapabilityArtifact,
  validateCapabilityArtifactSemantics,
} from '../../src/artifact/index.js';

const artifactPath = join(process.cwd(), 'artifacts', 'lookup_savings_balance', '1.0.0.json');

async function loadArtifact() {
  const raw = JSON.parse(await readFile(artifactPath, 'utf8')) as unknown;

  const artifact = parseCapabilityArtifact(raw);

  validateCapabilityArtifactSemantics(artifact);

  return artifact;
}

describe('artifact reviewer readability', () => {
  it('explains what the capability does from the artifact alone', async () => {
    const artifact = await loadArtifact();

    expect(artifact.identity).toMatchObject({
      id: 'lookup_savings_balance',

      name: 'Lookup Savings Balance',

      description:
        'Searches for a member and returns the current balance of their Savings account.',
    });
  });

  it('declares the required input and returned output', async () => {
    const artifact = await loadArtifact();

    expect(artifact.inputs).toEqual([
      {
        name: 'memberName',

        type: 'string',

        required: true,

        description: 'Member name used for search.',

        sensitive: true,
      },
    ]);

    expect(artifact.outputs).toEqual([
      {
        name: 'savingsBalance',

        type: 'currency',

        required: true,

        description: "Current balance of the member's Savings account.",
      },
    ]);
  });

  it('shows the complete reusable workflow and semantic targets', async () => {
    const artifact = await loadArtifact();

    expect(
      artifact.steps.map((step) => ({
        id: step.id,

        action: step.action.kind,

        target: step.target?.description,
      })),
    ).toEqual([
      {
        id: 'enter-member-search',

        action: 'type',

        target: 'textbox named "Member Name"',
      },

      {
        id: 'submit-member-search',

        action: 'click',

        target: 'button named "Search"',
      },

      {
        id: 'open-accounts',

        action: 'click',

        target: 'link named "Accounts"',
      },

      {
        id: 'read-savings-balance',

        action: 'read',

        target:
          'table cell in "Accounts" where "Account Type" equals "Savings" column "Current Balance"',
      },
    ]);
  });

  it('makes the structural Savings lookup understandable without discovery evidence', async () => {
    const artifact = await loadArtifact();

    const step = artifact.steps.find((candidate) => candidate.id === 'read-savings-balance');

    expect(step?.target).toMatchObject({
      strategies: [
        {
          kind: 'structural',

          query: {
            kind: 'table-cell',

            table: {
              name: {
                value: 'Accounts',
              },
            },

            row: {
              columnHeader: {
                value: 'Account Type',
              },

              value: {
                value: 'Savings',
              },
            },

            column: {
              header: {
                value: 'Current Balance',
              },
            },
          },
        },
      ],
    });
  });

  it('declares observable business outcomes', async () => {
    const artifact = await loadArtifact();

    expect(artifact.knownBusinessOutcomes).toEqual([
      {
        code: 'MEMBER_NOT_FOUND',

        description: 'No member matched the supplied lookup input.',

        detector: {
          kind: 'textPresent',

          text: 'Member not found',

          match: 'contains',

          caseSensitive: false,
        },
      },
    ]);
  });

  it('shows exactly what proves successful completion', async () => {
    const artifact = await loadArtifact();

    expect(artifact.successCondition).toMatchObject({
      kind: 'all',

      conditions: [
        {
          kind: 'surface',

          condition: {
            kind: 'elementVisible',
          },
        },

        {
          kind: 'outputPresent',

          output: {
            kind: 'outputRef',

            name: 'savingsBalance',
          },
        },
      ],
    });
  });

  it('makes capability and step risk visible to the reviewer', async () => {
    const artifact = await loadArtifact();

    expect(artifact.risk).toEqual({
      summaryRisk: 'READ_ONLY',

      maxStepRisk: 'REVERSIBLE',

      requiresHumanByDefault: false,

      runtimePolicyRequired: true,
    });

    expect(artifact.steps.map((step) => [step.id, step.risk])).toEqual([
      ['enter-member-search', 'REVERSIBLE'],
      ['submit-member-search', 'READ_ONLY'],
      ['open-accounts', 'READ_ONLY'],
      ['read-savings-balance', 'READ_ONLY'],
    ]);
  });

  it('provides compact provenance back to the producing discovery run', async () => {
    const artifact = await loadArtifact();

    expect(artifact.provenance).toEqual({
      discoveryRunId: '9635c0c9-dc3a-4b64-aa38-b1f48a359ea0',

      compiledAt: '2026-09-18T16:00:00.000Z',

      compilerVersion: '1',

      sourceGoal: 'Look up a member and return their current savings balance.',
    });
  });

  it('declares its application compatibility without runtime deployment state', async () => {
    const artifact = await loadArtifact();

    expect(artifact.compatibility).toEqual({
      application: 'demo-bank',

      vendorFamily: 'demo-core',

      surfaceKind: 'web',

      supportedVersionRange: '1.x',
    });
  });
});
