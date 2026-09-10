import { createDemoServer } from '../../demo-app/server.js';

const host = '127.0.0.1';
const port = 3000;
const server = createDemoServer();

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    process.stderr.write(`Port ${port} is already in use. Stop the other server and retry.\n`);
  } else {
    process.stderr.write('The demo banking server could not start.\n');
  }

  process.exitCode = 1;
});

server.listen(port, host, () => {
  process.stdout.write(`Demo banking app: http://${host}:${port}/member-search\n`);
});

let stopping = false;

function shutdown(): void {
  if (stopping) {
    return;
  }

  stopping = true;

  server.close((error) => {
    if (error) {
      process.stderr.write('The demo server could not close cleanly.\n');
      process.exitCode = 1;
    }
  });

  server.closeAllConnections();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
