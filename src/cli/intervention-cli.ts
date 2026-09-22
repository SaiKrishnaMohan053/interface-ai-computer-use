import { randomUUID } from 'node:crypto';

interface CliConfig {
  baseUrl: string;
}

interface OperatorInterventionView {
  id: string;

  status: string;

  source: string;

  reasonCode: string;

  reason: string;

  capabilityId?: string;

  capabilityVersion?: string;

  goal?: string;

  stepId?: string;

  observedState: string;

  acquisition?: {
    acquisitionId: string;

    acquiredAt: string;

    operatorId?: string;
  };
}

type Command =
  | {
      kind: 'list';
    }
  | {
      kind: 'show';

      interventionId: string;
    }
  | {
      kind: 'acquire';

      interventionId: string;

      operatorId?: string;
    }
  | {
      kind: 'start';

      interventionId: string;
    };

function config(): CliConfig {
  const baseUrl = process.env.INTERVENTION_CONTROL_URL ?? 'http://127.0.0.1:4177';

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
  };
}

function parseArgs(argv: readonly string[]): Command {
  const [kind, interventionId] = argv;

  if (kind === 'list') {
    return {
      kind: 'list',
    };
  }

  if (kind === 'show' || kind === 'acquire' || kind === 'start') {
    if (interventionId === undefined || interventionId.trim().length === 0) {
      throw new Error(`${kind} requires an intervention id`);
    }

    if (kind === 'show') {
      return {
        kind,
        interventionId,
      };
    }

    if (kind === 'start') {
      return {
        kind,
        interventionId,
      };
    }

    const operatorId = process.env.INTERVENTION_OPERATOR_ID;

    return {
      kind: 'acquire',
      interventionId,

      ...(operatorId === undefined || operatorId.trim().length === 0
        ? {}
        : {
            operatorId: operatorId.trim(),
          }),
    };
  }

  throw new Error(
    [
      'Unknown intervention command.',
      '',
      'Usage:',
      '  intervention list',
      '  intervention show <id>',
      '  intervention acquire <id>',
      '  intervention start <id>',
    ].join('\n'),
  );
}

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  let response: Response;

  try {
    response = await fetch(url, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown network error';

    throw new Error(`Cannot reach operator control server at ${url}: ${message}`);
  }

  const text = await response.text();

  let body: unknown = null;

  if (text.trim().length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    let message = `HTTP ${response.status}`;

    if (typeof body === 'object' && body !== null && 'message' in body) {
      const candidate = (body as Record<string, unknown>).message;

      if (typeof candidate === 'string') {
        message = candidate;
      }
    }

    throw new Error(message);
  }

  return body;
}

function assertInterventionView(value: unknown): OperatorInterventionView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Operator server returned an invalid intervention payload');
  }

  const record = value as Record<string, unknown>;

  for (const key of ['id', 'status', 'source', 'reasonCode', 'reason', 'observedState'] as const) {
    if (typeof record[key] !== 'string') {
      throw new Error(`Operator server payload is missing ${key}`);
    }
  }

  return value as OperatorInterventionView;
}

function assertInterventionList(value: unknown): OperatorInterventionView[] {
  if (!Array.isArray(value)) {
    throw new Error('Operator server returned an invalid intervention list');
  }

  return value.map(assertInterventionView);
}

function printIntervention(intervention: OperatorInterventionView): void {
  const lines = [
    `ID: ${intervention.id}`,
    `Status: ${intervention.status}`,
    `Source: ${intervention.source}`,
    `Reason code: ${intervention.reasonCode}`,
    `Reason: ${intervention.reason}`,
  ];

  if (intervention.capabilityId !== undefined) {
    lines.push(
      `Capability: ${intervention.capabilityId}${
        intervention.capabilityVersion === undefined ? '' : `@${intervention.capabilityVersion}`
      }`,
    );
  }

  if (intervention.goal !== undefined) {
    lines.push(`Goal: ${intervention.goal}`);
  }

  if (intervention.stepId !== undefined) {
    lines.push(`Step: ${intervention.stepId}`);
  }

  lines.push(`Observed state: ${intervention.observedState}`);

  if (intervention.acquisition !== undefined) {
    lines.push(
      `Acquisition: ${intervention.acquisition.acquisitionId}`,
      `Acquired at: ${intervention.acquisition.acquiredAt}`,
    );

    if (intervention.acquisition.operatorId !== undefined) {
      lines.push(`Operator: ${intervention.acquisition.operatorId}`);
    }
  }

  process.stdout.write(`${lines.join('\n')}\n`);
}

async function run(command: Command, cliConfig: CliConfig): Promise<void> {
  if (command.kind === 'list') {
    const body = assertInterventionList(await requestJson(`${cliConfig.baseUrl}/interventions`));

    if (body.length === 0) {
      process.stdout.write('No interventions found.\n');

      return;
    }

    for (let index = 0; index < body.length; index += 1) {
      if (index > 0) {
        process.stdout.write('\n');
      }

      printIntervention(body[index]!);
    }

    return;
  }

  if (command.kind === 'show') {
    const body = assertInterventionView(
      await requestJson(
        `${cliConfig.baseUrl}/interventions/${encodeURIComponent(command.interventionId)}`,
      ),
    );

    printIntervention(body);

    return;
  }

  if (command.kind === 'acquire') {
    const body = assertInterventionView(
      await requestJson(
        `${cliConfig.baseUrl}/interventions/${encodeURIComponent(command.interventionId)}/acquire`,
        {
          method: 'POST',

          headers: {
            'content-type': 'application/json',
          },

          body: JSON.stringify({
            acquisitionId: randomUUID(),

            ...(command.operatorId === undefined
              ? {}
              : {
                  operatorId: command.operatorId,
                }),
          }),
        },
      ),
    );

    process.stdout.write(`Acquired ${body.id}\n`);

    process.stdout.write(`Status: ${body.status}\n`);

    process.stdout.write('Session owner: HUMAN\n');

    process.stdout.write('The existing headed browser remains available for manual interaction.\n');

    return;
  }

  const body = assertInterventionView(
    await requestJson(
      `${cliConfig.baseUrl}/interventions/${encodeURIComponent(command.interventionId)}/start`,
      {
        method: 'POST',
      },
    ),
  );

  process.stdout.write(`Intervention ${body.id} is ${body.status}\n`);
}

async function main(): Promise<void> {
  try {
    await run(parseArgs(process.argv.slice(2)), config());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown CLI error';

    process.stderr.write(`${message}\n`);

    process.exitCode = 1;
  }
}

void main();
