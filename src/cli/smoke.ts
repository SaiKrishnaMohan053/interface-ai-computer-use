import { once } from 'node:events';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemoServer } from '../../demo-app/server.js';

export interface SmokeResult {
  readonly status: 'ok';
  readonly check: 'demo-http-surface';
  readonly httpStatus: 200;
  readonly title: 'Member Search';
  readonly readyMarker: true;
}

async function listen(server: Server): Promise<number> {
  server.listen(0, '127.0.0.1');

  await once(server, 'listening');

  const address = server.address();

  if (address === null || typeof address === 'string') {
    throw new Error('Smoke server did not expose a TCP port');
  }

  return address.port;
}

async function close(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  const closed = new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) {
        rejectClose(error);
      } else {
        resolveClose();
      }
    });
  });

  server.closeAllConnections();

  await closed;
}

/**
 * Development smoke check only.
 *
 * It verifies that the local demo HTTP surface starts
 * and renders its stable entry point.
 *
 * It does not run discovery, replay, an LLM,
 * or a banking action.
 */
export async function runSmoke(): Promise<SmokeResult> {
  const server = createDemoServer();

  try {
    /*
     * Use an ephemeral port so smoke does not conflict
     * with npm run dev using port 3000.
     */
    const port = await listen(server);

    const response = await fetch(`http://127.0.0.1:${port}/member-search`, {
      signal: AbortSignal.timeout(5_000),
      redirect: 'error',
    });

    const html = await response.text();

    if (response.status !== 200) {
      throw new Error(`Expected HTTP 200, received ${response.status}`);
    }

    if (!html.includes('<h1>Member Search</h1>')) {
      throw new Error('Member Search heading was not rendered');
    }

    if (!html.includes('data-surface-ready="true"')) {
      throw new Error('Surface ready marker was not rendered');
    }

    return Object.freeze({
      status: 'ok',
      check: 'demo-http-surface',
      httpStatus: 200,
      title: 'Member Search',
      readyMarker: true,
    });
  } finally {
    await close(server);
  }
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isEntryPoint) {
  try {
    const result = await runSmoke();

    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    /*
     * Avoid printing arbitrary internal exceptions.
     * Future CLI error contracts will provide safe diagnostics.
     */
    process.stderr.write('Smoke check failed.\n');

    process.exitCode = 1;
  }
}
