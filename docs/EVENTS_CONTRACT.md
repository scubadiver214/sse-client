# Event contract

`@mmozer/sse-client` doesn't assume any specific event schema — the `TEventMap`
generic passed to `SseClient`/`useSse` fully determines which event names and
payload shapes a given connection carries.

No backend SSE endpoint exists yet as of this writing. Until it does,
`examples/mock-sse-server.ts` in this repo implements this exact contract so
the client (and any consuming UI) can be built and tested end-to-end.

## Transport

- `GET` request, `Content-Type: text/event-stream` response.
- Auth: same mechanism as the app's existing REST calls (session cookie via
  the Next.js `/api/backend` proxy, which forwards a bearer token upstream).
  No custom headers are required from the browser.
- Servers should emit a `: heartbeat` comment line periodically (e.g. every
  15-30s) to keep intermediate proxies/load balancers from closing the
  connection during idle periods.
- Servers should send an `id:` field with every event so clients can resume
  with `Last-Event-ID` after a reconnect without missing/duplicating events
  (`@mmozer/sse-client` sends this header automatically).

## Event: `audit-event`

Mirrors the shape already consumed by `NotificationsMenu` (previously
polled from an audit-log REST endpoint).

```ts
interface AuditEventPayload {
  eventId: number;
  action: 'I' | 'U' | 'D';
  tableName: string;
  schemaName: string;
  changedFields: string[];
  eventTimeUtc: string; // ISO-8601
}
```

Wire example:

```
id: 1024
event: audit-event
data: {"eventId":1024,"action":"U","tableName":"menu_publish_jobs","schemaName":"public","changedFields":["status"],"eventTimeUtc":"2026-08-02T17:41:00Z"}

```

## Event: `menu-status-changed`

Emitted whenever a location's menu processing/publication status changes, so
the menu-publisher dashboard and map can update without re-polling.

```ts
interface MenuStatusChangedPayload {
  locationNumber: number;
  environmentKind: 'dev' | 'test' | 'prod'; // matches `EnvironmentKind` in the admin UI
  processing: boolean;
  publishCompleted: boolean;
  updatedAtUtc: string; // ISO-8601
}
```

Wire example:

```
id: 1025
event: menu-status-changed
data: {"locationNumber":4021,"environmentKind":"dev","processing":false,"publishCompleted":true,"updatedAtUtc":"2026-08-02T17:41:05Z"}

```

## Versioning / extensibility

New event types can be added at any time without breaking existing
consumers — clients only receive callbacks for the event names they
explicitly subscribe to (`client.on('some-new-event', ...)`) or via the
wildcard `'*'` channel. Payload shape changes to an existing event name
should be treated as breaking and coordinated with consumers ahead of time.
