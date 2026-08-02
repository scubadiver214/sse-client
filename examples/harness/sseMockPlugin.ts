import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Plugin } from 'vite';

const HEARTBEAT_INTERVAL_MS = 15_000;
const DATA_EVENT_INTERVAL_MS = 2000;

let nextEventId = 1;

function allocEventId(): number {
  return nextEventId++;
}

function sseEvent(id: number, event: string, data: unknown): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function randomAuditEvent(): string {
  const actions = ['I', 'U', 'D'] as const;
  const tables = ['menu_publish_jobs', 'store_locations', 'menu_items'];
  const eventId = allocEventId();
  return sseEvent(eventId, 'audit-event', {
    eventId,
    action: actions[Math.floor(Math.random() * actions.length)],
    tableName: tables[Math.floor(Math.random() * tables.length)],
    schemaName: 'public',
    changedFields: ['status'],
    eventTimeUtc: new Date().toISOString(),
  });
}

function randomMenuStatusEvent(): string {
  const id = allocEventId();
  const locationNumber = 1000 + Math.floor(Math.random() * 50);
  const processing = Math.random() < 0.5;
  return sseEvent(id, 'menu-status-changed', {
    locationNumber,
    environmentKind: 'dev',
    processing,
    publishCompleted: !processing && Math.random() < 0.5,
    updatedAtUtc: new Date().toISOString(),
  });
}

function handleStream(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');

  const lastEventId = req.headers['last-event-id'];
  if (typeof lastEventId === 'string') {
    const parsed = Number.parseInt(lastEventId, 10);
    if (!Number.isNaN(parsed) && parsed >= nextEventId) {
      nextEventId = parsed + 1;
    }
  }

  const dataInterval = setInterval(() => {
    res.write(Math.random() < 0.5 ? randomAuditEvent() : randomMenuStatusEvent());
  }, DATA_EVENT_INTERVAL_MS);

  const heartbeatInterval = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, HEARTBEAT_INTERVAL_MS);

  const cleanup = () => {
    clearInterval(dataInterval);
    clearInterval(heartbeatInterval);
  };

  req.on('close', cleanup);
  res.on('close', cleanup);
}

/**
 * Serves the contract mock at same-origin `/stream` inside the Vite dev server.
 * Avoids cross-origin/`127.0.0.1` fetch failures that show up as
 * `network-error: Failed to reach SSE endpoint` in the browser.
 */
export function sseMockPlugin(): Plugin {
  return {
    name: 'sse-mock-plugin',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        if (url !== '/stream') {
          next();
          return;
        }

        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }

        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end();
          return;
        }

        handleStream(req as IncomingMessage, res as ServerResponse);
      });
    },
  };
}
