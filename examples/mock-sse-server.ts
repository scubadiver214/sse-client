/**
 * Standalone mock SSE server implementing the contract in `EVENTS_CONTRACT.md`.
 * Useful for exercising `@mmozer/sse-client` (and any consuming UI) end-to-end
 * before a real backend endpoint exists.
 *
 * Run with: `pnpm example:mock-server` (defaults to http://localhost:4310/stream)
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_SSE_PORT ?? 4310);
const HEARTBEAT_INTERVAL_MS = 15_000;

let nextEventId = 1;

function sseEvent(event: string, data: unknown): string {
  const id = nextEventId++;
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function randomAuditEvent() {
  const actions = ['I', 'U', 'D'] as const;
  const tables = ['menu_publish_jobs', 'store_locations', 'menu_items'];
  return sseEvent('audit-event', {
    eventId: nextEventId,
    action: actions[Math.floor(Math.random() * actions.length)],
    tableName: tables[Math.floor(Math.random() * tables.length)],
    schemaName: 'public',
    changedFields: ['status'],
    eventTimeUtc: new Date().toISOString(),
  });
}

function randomMenuStatusEvent() {
  const locationNumber = 1000 + Math.floor(Math.random() * 50);
  const processing = Math.random() < 0.5;
  return sseEvent('menu-status-changed', {
    locationNumber,
    environmentKind: 'dev',
    processing,
    publishCompleted: !processing && Math.random() < 0.5,
    updatedAtUtc: new Date().toISOString(),
  });
}

const server = createServer((req, res) => {
  if (req.url !== '/stream') {
    res.writeHead(404).end();
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const lastEventId = req.headers['last-event-id'];
  if (lastEventId) {
    console.log(`Client resumed from Last-Event-ID: ${lastEventId}`);
  }

  const dataInterval = setInterval(() => {
    res.write(Math.random() < 0.5 ? randomAuditEvent() : randomMenuStatusEvent());
  }, 2000);

  const heartbeatInterval = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, HEARTBEAT_INTERVAL_MS);

  req.on('close', () => {
    clearInterval(dataInterval);
    clearInterval(heartbeatInterval);
  });
});

server.listen(PORT, () => {
  console.log(`Mock SSE server listening at http://localhost:${PORT}/stream`);
});
