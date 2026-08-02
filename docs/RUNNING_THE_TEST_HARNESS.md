# Running the Test Harness — Live SSE Events

This guide shows how to watch Server-Sent Events (SSE) in real time. There are two options:

1. **Standalone mock server** — fastest; no login required; watch the raw event stream
2. **Full app UI** — end-to-end path through `menu-admin-ui` (notifications + menu publisher)

> **Note:** Unit tests (`pnpm test`) assert behavior; they do not stream live events. Use this guide for the interactive demo harness.

---

## Option A — Standalone mock server (fastest)

Runs the mock SSE server from `sse-client` only. No app login needed.

### 1. Start the mock server

```bash
cd sse-client
pnpm example:mock-server
```

You should see:

```text
Mock SSE server listening at http://localhost:4310/stream
```

### 2. Watch the stream

In a second terminal:

```bash
curl -N http://localhost:4310/stream
```

`-N` disables buffering so each event prints as it arrives.

### What you should see

Roughly every ~2 seconds, alternating `audit-event` and `menu-status-changed` payloads, for example:

```text
id: 1
event: menu-status-changed
data: {"locationNumber":1023,"environmentKind":"dev","processing":false,"publishCompleted":false,"updatedAtUtc":"..."}

id: 2
event: audit-event
data: {"eventId":2,"action":"U","tableName":"store_locations","schemaName":"public","changedFields":["status"],"eventTimeUtc":"..."}
```

Heartbeats appear as SSE comments about every 15 seconds:

```text
: heartbeat
```

Press `Ctrl+C` in either terminal to stop.

---

## Option B — See events in the app UI

Exercises the full path: Next.js mock route → `@mmozer/sse-client` → React hooks → `NotificationsMenu` / menu publisher.

### Prerequisites

- `menu-admin-ui` depends on `@mmozer/sse-client` via a local `link:` (already configured for local development)
- Build the client package if you have not yet:

```bash
cd sse-client
pnpm build
```

### 1. Start the admin UI

```bash
cd menu-admin-ui
pnpm dev
```

If `pnpm dev` fails because the checkout has no `.git` directory (the `predev` script reads git metadata), bypass the hook and start Next.js directly:

```bash
pnpm exec next dev --experimental-https --experimental-https-key ./certificates/localhost-key.pem --experimental-https-cert ./certificates/localhost.pem
```

### 2. Use the UI

1. Open the app in the browser and log in.
2. Select an environment (required — the live stream connects when an environment is selected).
3. Click the **notifications bell** in the top bar:
   - A green connection dot appears when the stream is open
   - Audit events appear in the menu as they arrive (~every few seconds from the dev mock)
4. Open **Menu Publisher** — map/dashboard data refreshes when `menu-status-changed` events arrive (via React Query invalidation; no extra polling).

### 3. Inspect the wire format in DevTools

1. Open browser DevTools → **Network**
2. Find the request to `/api/dev/live-events`
3. In Chrome, open the **EventStream** tab to watch each event live

The in-app mock is served only in non-production (`NODE_ENV !== 'production'`) at:

```text
/api/dev/live-events?environmentKind=<kind>
```

If `NEXT_PUBLIC_LIVE_EVENTS_URL` is set, the UI uses that template instead of the local mock.

---

## Quick reference

| Goal                         | Command / path                                      |
|-----------------------------|-----------------------------------------------------|
| Mock server only            | `pnpm example:mock-server` (in `sse-client`)    |
| Raw stream                  | `curl -N http://localhost:4310/stream`              |
| App + UI                    | `pnpm dev` (in `menu-admin-ui`)                 |
| In-app mock endpoint        | `/api/dev/live-events`                              |
| Event contract              | See `EVENTS_CONTRACT.md` in the package root        |
| System overview             | See [SYSTEM_OVERVIEW.md](./SYSTEM_OVERVIEW.md)      |
| Lunch & learn slides        | See [LUNCH_AND_LEARN.md](./LUNCH_AND_LEARN.md)      |
