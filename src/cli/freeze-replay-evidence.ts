import { createHash } from 'node:crypto';

import { once } from 'node:events';

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';

import { join, relative, resolve } from 'node:path';

import { createDemoServer } from '../../demo-app/server.js';

import { ArtifactStore } from '../artifact/index.js';

import { PolicyEngine } from '../policy/index.js';

import {
  ReplayBrowserStepExecutor,
  ReplayEngine,
  ReplayOutputStore,
  evaluateReplaySuccessCondition,
  recordReplayEvidence,
  type ReplayEvidenceSink,
} from '../replay/index.js';

import { RunCoordinator } from '../runtime/index.js';

import { PlaywrightSurface } from '../surface/playwright/index.js';

import type { PlaywrightStrategy } from '../surface/playwright/index.js';

type FrozenScenario = 'success' | 'member-not-found' | 'recovery' | 'failure';

interface ScenarioDefinition {
  readonly scenario: FrozenScenario;

  readonly directoryName: string;

  readonly artifactVersion: '1.0.0' | '1.0.1';

  readonly memberName: string;

  readonly queryScenario: 'normal' | 'dialog' | 'app-error';
}

const EVIDENCE_ROOT = resolve('evidence');

const DEFINITIONS: readonly ScenarioDefinition[] = [
  {
    scenario: 'success',

    directoryName: 'replay-success',

    artifactVersion: '1.0.0',

    memberName: 'Alex Morgan',

    queryScenario: 'normal',
  },

  {
    scenario: 'member-not-found',

    directoryName: 'replay-member-not-found',

    artifactVersion: '1.0.1',

    memberName: 'Unknown Member',

    queryScenario: 'normal',
  },

  {
    scenario: 'recovery',

    directoryName: 'replay-recovery',

    artifactVersion: '1.0.1',

    memberName: 'Alex Morgan',

    queryScenario: 'dialog',
  },

  {
    scenario: 'failure',

    directoryName: 'replay-failure',

    artifactVersion: '1.0.1',

    memberName: 'Alex Morgan',

    queryScenario: 'app-error',
  },
];

function createPolicy(origin: string): PolicyEngine {
  return new PolicyEngine({
    policyId: 'replay-evidence-freeze-policy',

    version: 1,

    defaultDecision: 'DENY',

    allowedOrigins: [origin],

    allowedRoutes: [
      {
        routeId: 'member-search',

        description: 'Member search',

        match: {
          kind: 'exact',

          pathname: '/member-search',
        },
      },

      {
        routeId: 'member-details',

        description: 'Member details',

        match: {
          kind: 'prefix',

          pathname: '/member/',
        },
      },
    ],

    allowedActions: ['navigate', 'type', 'click', 'read'],

    riskRules: [
      {
        ruleId: 'read-only',

        description: 'Allow read-only replay operations',

        match: {
          actions: ['navigate', 'click', 'read'],
        },

        riskLevel: 'READ_ONLY',

        decision: 'ALLOW',
      },

      {
        ruleId: 'reversible',

        description: 'Allow reversible replay input',

        match: {
          actions: ['type'],
        },

        riskLevel: 'REVERSIBLE',

        decision: 'ALLOW',
      },
    ],
  });
}

async function removeEmptyRuntimeDirectories(directory: string): Promise<void> {
  for (const name of ['traces', 'screenshots']) {
    const path = join(directory, name);

    try {
      const entries = await readdir(path);

      if (entries.length === 0) {
        await rm(path, {
          recursive: true,

          force: true,
        });
      }
    } catch {
      // Directory was not created or is already absent.
    }
  }
}

async function filesRecursively(directory: string): Promise<string[]> {
  const entries = await readdir(directory, {
    withFileTypes: true,
  });

  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === 'SHA256SUMS.txt') {
      continue;
    }

    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await filesRecursively(path)));

      continue;
    }

    files.push(path);
  }

  return files.sort();
}

async function writeChecksums(directory: string): Promise<void> {
  const files = await filesRecursively(directory);

  const lines: string[] = [];

  for (const file of files) {
    const bytes = await readFile(file);

    const digest = createHash('sha256').update(bytes).digest('hex');

    const name = relative(directory, file).replaceAll('\\', '/');

    lines.push(`${digest}  ${name}`);
  }

  await writeFile(join(directory, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`, 'utf8');
}

async function writeScenarioReadme(
  definition: ScenarioDefinition,

  directory: string,
): Promise<void> {
  const descriptions: Record<FrozenScenario, string> = {
    success:
      'Real deterministic replay of lookup_savings_balance with a valid member. The replay completes successfully and returns the declared savingsBalance output.',

    'member-not-found':
      'Real deterministic replay with an unknown member. MEMBER_NOT_FOUND is returned as a business outcome, not a hard failure.',

    recovery:
      'Real deterministic replay with the demo known-interstitial scenario. The artifact-authorized interstitial recovery is bounded, deterministic, and replay continues to success.',

    failure:
      'Real deterministic replay with the demo application-error scenario. Replay stops with APPLICATION_ERROR and preserves richer failure evidence including a screenshot.',
  };

  const expected: Record<FrozenScenario, string> = {
    success: 'success with savingsBalance = $12,840.50',

    'member-not-found': 'business_outcome with code MEMBER_NOT_FOUND',

    recovery: 'known interstitial recovered, followed by success',

    failure: 'failure with code APPLICATION_ERROR and screenshot evidence',
  };

  const markdown = `# Frozen Replay Evidence



This directory is reviewer-safe evidence from a real Playwright replay against the local synthetic banking demo.



## Scenario



${descriptions[definition.scenario]}



## Capability



- ID: \`lookup_savings_balance\`

- Version: \`${definition.artifactVersion}\`

- Replay mode: deterministic

- LLM decisions during replay: none

- Invocation input values are intentionally omitted from replay evidence; validated input names are recorded without persisting sensitive values.



## Expected terminal result



${expected[definition.scenario]}



## Files



- \`run.json\` â€” sanitized run metadata

- \`events.jsonl\` â€” sanitized structured event log

- \`result.json\` â€” sanitized terminal result

${
  definition.scenario === 'failure'
    ? '- `screenshots/` â€” synthetic-fixture failure screenshot\n'
    : ''
}- \`SHA256SUMS.txt\` â€” integrity hashes for this evidence package



Temporary traces and unrelated runtime artifacts are intentionally excluded.`;

  await writeFile(join(directory, 'README.md'), `${markdown}\n`, 'utf8');
}

async function runScenario(origin: string, definition: ScenarioDefinition): Promise<void> {
  const directory = join(EVIDENCE_ROOT, definition.directoryName);

  /*

   * Frozen evidence must represent one clean run.

   * Remove only the named reviewer directory.

   * UUID runtime folders are deliberately untouched.

   */

  await rm(directory, {
    recursive: true,

    force: true,
  });

  await mkdir(EVIDENCE_ROOT, {
    recursive: true,
  });

  const artifactStore = new ArtifactStore({
    rootDir: resolve('artifacts'),
  });

  const policyEngine = createPolicy(origin);

  const coordinator = new RunCoordinator<PlaywrightStrategy>({
    policyEngine,

    createSurface: ({ access, surfaceId }) =>
      new PlaywrightSurface(access.page, {
        sessionId: access.sessionId,

        surfaceId,
      }),
  });

  const runId = definition.directoryName;

  let finalized = false;

  try {
    const context = await coordinator.start({
      runId,

      mode: 'REPLAY',

      evidenceRoot: EVIDENCE_ROOT,

      headed: process.env.HEADED === '1',

      timeoutMs: 10_000,
    });

    const entryUrl = `${origin}/member-search?scenario=${definition.queryScenario}`;

    process.stdout.write(`  entry: ${entryUrl}\n`);

    /*
     * Bootstrap navigation is also an automated browser
     * operation, so verify REPLAY ownership immediately
     * before it starts.
     */
    const entryPolicy = context.policyEngine.evaluate({
      url: entryUrl,

      action: {
        kind: 'navigate',
      },

      systemRiskLevel: 'READ_ONLY',
    });

    if (entryPolicy.decision !== 'ALLOW') {
      throw new Error(`Initial replay navigation was not policy-allowed: ${entryPolicy.reason}`);
    }

    /*
     * Bootstrap navigation is still an automated browser action.
     * It therefore passes policy first and the same hard REPLAY
     * ownership boundary immediately before surface execution.
     */
    context.sessionManager.access('REPLAY');

    const navigation = await context.surface.perform(
      {
        actionId: 'replay-entry-navigation',

        action: {
          kind: 'navigate',

          destination: entryUrl,
        },
      },

      {
        timeoutMs: 5_000,
      },
    );

    if (navigation.status !== 'success') {
      throw new Error(`Initial navigation failed: ${navigation.error.message}`);
    }

    const replayEvidenceSink: ReplayEvidenceSink = {
      recordEvent: (event) =>
        context.evidenceRecorder.recordEvent({
          step: event.step,

          eventType: event.eventType,

          result: {
            stepId: event.stepId ?? null,

            details: event.details,
          },

          evidenceRefs: event.evidenceRefs,
        }),

      persistCapturedEvidence: async (captured, metadata) => {
        if (captured.kind !== 'screenshot') {
          throw new Error(`Unsupported frozen evidence kind "${captured.kind}".`);
        }

        return context.evidenceRecorder.captureScreenshot({
          step: metadata.step,

          bytes: captured.bytes,

          capturedAt: captured.capturedAt,

          dataHandling: 'SYNTHETIC_FIXTURE_ONLY',
        });
      },
    };

    /*

     * Every frozen scenario uses the same real replay evidence path.

     * Scenario-specific manual lifecycle logging is intentionally avoided.

     */

    const stepExecutor = new ReplayBrowserStepExecutor({
      surface: context.surface,

      policyEngine: context.policyEngine,

      operationTimeoutMs: 5_000,

      assertAutomationOwnership: () => {
        context.sessionManager.access('REPLAY');
      },

      evidenceSink: replayEvidenceSink,
    });

    const engine = new ReplayEngine({
      artifactStore,

      stepExecutor,

      evidenceSink: replayEvidenceSink,
    });

    const result = await engine.runOrderedSteps({
      capabilityId: 'lookup_savings_balance',

      version: definition.artifactVersion,

      inputs: {
        memberName: definition.memberName,
      },

      target: {
        entryUrl,
      },

      options: {
        timeoutMs: 10_000,
      },
    });

    switch (definition.scenario) {
      case 'success':
      // falls through: success and recovery share identical terminal validation.
      case 'recovery': {
        if (result.status !== 'success') {
          throw new Error(
            `${definition.scenario} freeze expected success, received:\n${JSON.stringify(
              result,

              null,

              2,
            )}`,
          );
        }

        if (result.outputs.savingsBalance !== '$12,840.50') {
          throw new Error(
            `Unexpected savingsBalance type/value: ${JSON.stringify(
              result.outputs.savingsBalance,
            )}`,
          );
        }

        const artifact = await artifactStore.load(
          'lookup_savings_balance',
          definition.artifactVersion,
        );

        const outputStore = new ReplayOutputStore(artifact);

        const storedOutput = outputStore.store(
          {
            kind: 'outputRef',
            name: 'savingsBalance',
          },
          result.outputs.savingsBalance,
        );

        if (storedOutput.status !== 'stored') {
          throw new Error('Frozen replay could not store savingsBalance for success verification.');
        }

        const successCondition = await evaluateReplaySuccessCondition({
          adapter: context.surface,
          condition: artifact.successCondition,
          outputStore,
          wait: {
            timeoutMs: 5_000,
            pollIntervalMs: 100,
          },
        });

        if (successCondition.status !== 'passed') {
          throw new Error('Frozen replay final success condition did not pass.');
        }

        await recordReplayEvidence({
          sink: replayEvidenceSink,
          eventType: 'success_condition.passed',
          step: result.stepsExecuted,
          details: {
            status: 'passed',
          },
          evidenceRefs: successCondition.evidenceRefs,
        });

        await coordinator.finish({
          status: 'success',

          result: {
            status: result.status,

            stepsExecuted: result.stepsExecuted,

            outputs: result.outputs,
          },
        });

        finalized = true;

        break;
      }

      case 'member-not-found': {
        if (result.status !== 'business_outcome' || result.outcome.code !== 'MEMBER_NOT_FOUND') {
          throw new Error(
            `member-not-found freeze expected MEMBER_NOT_FOUND business outcome, received ${result.status}.`,
          );
        }

        await coordinator.finish({
          status: 'business_outcome',

          result: {
            status: result.status,

            code: result.outcome.code,

            stepId: result.stepId,

            stepsExecuted: result.stepsExecuted,

            ...(result.outcome.details === undefined
              ? {}
              : {
                  details: result.outcome.details,
                }),
          },
        });

        finalized = true;

        break;
      }

      case 'failure': {
        if (result.status !== 'failure' || result.error.code !== 'APPLICATION_ERROR') {
          throw new Error(`failure freeze expected APPLICATION_ERROR, received ${result.status}.`);
        }

        await coordinator.fail({
          status: result.status,

          code: result.error.code,

          message: result.error.message,

          stepId: result.stepId,

          stepsExecuted: result.stepsExecuted,
        });

        finalized = true;

        break;
      }
    }

    await removeEmptyRuntimeDirectories(directory);

    await writeScenarioReadme(definition, directory);

    await writeChecksums(directory);
  } finally {
    if (!finalized && coordinator.state === 'ACTIVE') {
      await coordinator

        .fail({
          code: 'ACTION_FAILED',

          phase: 'evidence_freeze_cleanup',
        })

        .catch(() => undefined);
    }
  }
}

async function main(): Promise<void> {
  const server = createDemoServer();

  server.listen(0, '127.0.0.1');

  await once(server, 'listening');

  const address = server.address();

  if (address === null || typeof address === 'string') {
    server.close();

    throw new Error('Demo server has no port');
  }

  const origin = `http://127.0.0.1:${address.port}`;

  try {
    for (const definition of DEFINITIONS) {
      process.stdout.write(`Freezing ${definition.directoryName}...\n`);

      await runScenario(origin, definition);
    }
  } finally {
    server.close();

    await once(server, 'close');
  }

  process.stdout.write('Replay evidence freeze complete.\n');
}

await main();
