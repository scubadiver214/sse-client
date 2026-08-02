# @mmozer/sse-client

Transport-agnostic Server-Sent Events (SSE) client with a typed, event-name-based
pub/sub API, exponential-backoff reconnection, and optional React bindings.

Built to be consumed by any number of unrelated features pointed at any
number of endpoints — it has no opinion about what your events mean, only
about reliably delivering them.

## Why not just use `EventSource`?

The native `EventSource` API works, but:

- It can't send custom headers (only cookies), which rules out bearer-token auth.
- Its automatic reconnection has no configurable backoff/jitter and no hook to observe state.
- It's browser-only — no Node.js/edge runtime support.

This library reads the same `text/event-stream` wire format, but over `fetch` +
`ReadableStream`, so all of the above become configurable while staying
spec-compliant with any standard SSE server (including ones designed for
`EventSource`).

## Install

```bash
pnpm add @mmozer/sse-client
```

React bindings are optional; only pull in `@mmozer/sse-client/react` if you use them
(`react` is a peer dependency, not a hard dependency of the core package).

## Core usage (framework-agnostic)

```ts
import { SseClient } from '@mmozer/sse-client';

type AppEvents = {
  'audit-event': { eventId: number; action: 'I' | 'U' | 'D'; tableName: string };
  'menu-status-changed': { locationNumber: string; processing: boolean };
};

const client = new SseClient<AppEvents>({
  url: '/api/backend/api/v1/dev/menumanager/events/stream',
  reconnect: { initialDelayMs: 1000, maxDelayMs: 30_000 },
  onStateChange: (state) => console.log('connection state:', state),
});

const unsubscribe = client.on('audit-event', (event, meta) => {
  console.log(`[${meta.id}]`, event.tableName, event.action);
});

client.connect();

// later
unsubscribe();
client.disconnect();
```

Subscribe to every event regardless of name with the wildcard channel:

```ts
client.on('*', (payload, meta) => console.log(meta.event, payload));
```

## React usage

```tsx
import { useSse, useSseEvent } from '@mmozer/sse-client/react';

type AppEvents = {
  'audit-event': AuditEvent;
  'menu-status-changed': MenuStatusChangedEvent;
};

function NotificationsMenu() {
  const { client, state } = useSse<AppEvents>({
    url: '/api/backend/api/v1/dev/menumanager/events/stream',
  });

  const [notifications, setNotifications] = useState<AuditEvent[]>([]);
  useSseEvent(client, 'audit-event', (event) => {
    setNotifications((prev) => [event, ...prev].slice(0, 50));
  });

  // `state` is one of: 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'failed'
  return <Badge invisible={state !== 'open'}>{/* ... */}</Badge>;
}
```

Multiple components pointed at the **same URL** automatically share one
underlying HTTP connection (refcounted; the connection closes once the last
subscriber unmounts) — so a notifications bell and a live map can both
subscribe to the same stream without opening it twice:

```tsx
// Component A
const { client } = useSse<AppEvents>({ url: STREAM_URL });
useSseEvent(client, 'audit-event', handleAudit);

// Component B, anywhere else in the tree
const { client } = useSse<AppEvents>({ url: STREAM_URL });
useSseEvent(client, 'menu-status-changed', handleMenuStatus);
```

Pass `null` instead of an options object to stay disconnected conditionally
(mirrors the `enabled` pattern used by `react-query` hooks in this codebase):

```ts
useSse(hasSelectedEnvironment ? { url: streamUrl } : null);
```

### Feeding React Query from live events

`@mmozer/sse-client` doesn't depend on `react-query`, but pairs naturally with
it — patch or invalidate a query's cache from an event handler:

```tsx
const queryClient = useQueryClient();
useSseEvent(client, 'menu-status-changed', (event) => {
  queryClient.setQueryData<MenuData[]>(menuQueryKeys.processingStatusMap({ environmentKind, status }), (prev) =>
    prev?.map((m) => (m.locationNumber === event.locationNumber ? { ...m, ...event } : m))
  );
});
```

## API

### `SseClient<TEventMap>`

| Member | Description |
| --- | --- |
| `connect()` | Opens the connection. Idempotent while already connecting/open. |
| `disconnect()` | Closes the connection and cancels any pending reconnect. |
| `on(event, listener)` | Subscribe; returns an unsubscribe function. |
| `once(event, listener)` | Subscribe for a single event, then auto-unsubscribe. |
| `off(event, listener)` | Unsubscribe. |
| `on('*', listener)` | Subscribe to every event regardless of name. |
| `getState()` / `onStateChange(fn)` | Read/observe `'idle' \| 'connecting' \| 'open' \| 'reconnecting' \| 'closed' \| 'failed'`. |
| `onError(fn)` | Observe transport/parse errors (`SseClientError`, with `.reason` of `'http-error' \| 'network-error' \| 'parse-error' \| 'aborted'`). |
| `getLastEventId()` | The most recent `id:` seen, for manual resumption elsewhere. |

### `SseClientOptions`

| Option | Description |
| --- | --- |
| `url` | The `text/event-stream` endpoint. |
| `headers` | Static object or `() => object \| Promise<object>`, merged into the request (e.g. bearer tokens). |
| `credentials` | Forwarded to `fetch`. Defaults to `'same-origin'`. |
| `parse` | Custom decoder per event name. Defaults to `JSON.parse`. |
| `reconnect` | `{ enabled, initialDelayMs, maxDelayMs, factor, jitter, maxAttempts }`. Set `enabled: false` to disable auto-reconnect. |
| `fetch` | Inject a custom `fetch` (tests, non-browser runtimes). |

### React: `useSse(options)` / `useSseEvent(client, event, handler)`

See [Usage](#react-usage) above; full option docs are in the TypeScript
definitions (`UseSseOptions`, `UseSseResult`).

## Event contract

This package places no constraints on event names/payloads. See
[`EVENTS_CONTRACT.md`](./EVENTS_CONTRACT.md) for the concrete contract
and `examples/mock-sse-server.ts` for a runnable server implementing it.

```bash
pnpm example:mock-server   # serves http://localhost:4310/stream
```

## Development

```bash
pnpm install
pnpm test          # vitest
pnpm typecheck
pnpm lint
pnpm build          # tsup -> dist/
```

## Publishing

```bash
pnpm build
pnpm publish --no-git-checks
```
