# Running the Test Harness — Live SSE Events

Ways to watch Server-Sent Events (SSE) in real time while developing `@mmozer/sse-client`.

| Option | Best for | Login? |
|--------|----------|--------|
| **A. UI harness** (recommended) | Seeing events in a browser using the real React hooks | No |
| **B. Raw `curl` stream** | Inspecting wire format only | No |
| **C. menu-admin-ui** | End-to-end product path (notifications + menu publisher) | Yes |

> Unit tests (`pnpm test` / `pnpm test:run`) assert behavior; they do **not** stream live events.

---

## Option A — UI test harness (recommended)

One command starts a Vite/React UI on port **5173**. The contract mock is served **same-origin** at `/stream` by a Vite middleware plugin (`examples/harness/sseMockPlugin.ts`). No separate mock process and no cross-origin requests are required for the UI.

> Tip: `pnpm example:mock-server` (port **4310**) is only for raw `curl` testing (Option B), not for the UI harness.

### Layout

| Path | Role |
|------|------|
| `examples/harness/` | Vite + React UI (`App.tsx`, styles, entry) |
| `examples/harness/sseMockPlugin.ts` | Same-origin SSE mock at `/stream` |
| `examples/harness/vite.config.ts` | Aliases `@mmozer/sse-client` → `src/` for live reload |
| `examples/mock-sse-server.ts` | Standalone Node mock (Option B) |

### Prerequisites

- Node.js 20+
- `pnpm` (see `packageManager` in `package.json`)

### 1. Install (once)

```bash
cd sse-client
pnpm install
```

### 2. Start the harness

```bash
pnpm example:harness
```

Expected terminal output:

```text
➜  Local:   http://localhost:5173/
```

### 3. Open the UI

Open **[http://localhost:5173/](http://localhost:5173/)** in your browser.

What you should see:

| UI element | Meaning |
|------------|---------|
| Status **Live** (green pulse) | SSE connection is open |
| Event cards every ~2s | Alternating `audit-event` and `menu-status-changed` from the mock |
| Filters | Show all events, or only one event type (with counts) |
| **Pause feed** | Keeps the connection open but stops appending cards |
| **Disconnect** / **Connect** | Tears down or re-opens the client |
| **Clear** | Empties the in-memory feed |
| `last id …` | Most recent SSE `id:` (used for `Last-Event-ID` on reconnect) |

The harness uses `useSse` from this package (aliased to `src/`), so library changes hot-reload without a separate `pnpm build`.

### 4. Optional — verify the stream outside the UI

While the harness is running:

```bash
curl -N http://localhost:5173/stream
```

You should see `: connected`, then `audit-event` / `menu-status-changed` blocks every ~2 seconds.

### 5. Stop

Press `Ctrl+C` in the terminal to stop Vite.

### Troubleshooting

| Symptom | Fix |
|---------|-----|
| `EADDRINUSE … :::5173` | Free the port: `lsof -ti :5173 \| xargs kill`, then `pnpm example:harness` |
| Status **Failed** / `network-error: Failed to reach SSE endpoint` | 1) Hard-refresh (Cmd+Shift+R). 2) Confirm you are on current `main` (the client must bind `fetch` — unbound `window.fetch` throws `Illegal invocation` in browsers). 3) Confirm `curl -N http://localhost:5173/stream` prints events. 4) Restart `pnpm example:harness` |
| Status stuck on **Connecting** / **Reconnecting** | Same checks as above; DevTools → Network should show a long-lived `GET /stream` with type `eventsource` / `fetch` and `200` |
| UI loads but no cards | Status should be **Live**; feed not paused; filter not hiding the event type |
| Expecting something on port **4310** | That port is only for Option B (`pnpm example:mock-server`). The UI harness uses **5173** only |

---

## Option B — Raw stream via curl

Use this when you only care about the SSE wire format (no browser).

### 1. Start the mock server

```bash
cd sse-client
pnpm example:mock-server
```

```text
Mock SSE server listening at http://127.0.0.1:4310/stream
```

### 2. Watch the stream

In a second terminal:

```bash
curl -N http://127.0.0.1:4310/stream
```

`-N` disables buffering so each event prints as it arrives.

### Example output

Roughly every ~2 seconds:

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

For `audit-event`, payload `eventId` matches the wire `id:`. The mock may honor `Last-Event-ID` by advancing its id counter; it does **not** replay a durable log.

Press `Ctrl+C` to stop.

---

## Option C — Events in menu-admin-ui

Exercises the product path: Next.js dev mock → linked package → `NotificationsMenu` / menu publisher.

### Prerequisites

- Local link from `lce-menu-admin-ui` to this package (e.g. `"@lce/sse-client": "link:../sse-client"` or equivalent)
- Build the client if the app resolves `dist/` rather than source:

```bash
cd sse-client
pnpm build
```

### 1. Start the admin UI

```bash
cd lce-menu-admin-ui
pnpm dev
```

If `pnpm dev` fails because the checkout has no `.git` directory (the `predev` script reads git metadata), start Next.js directly:

```bash
pnpm exec next dev --experimental-https --experimental-https-key ./certificates/localhost-key.pem --experimental-https-cert ./certificates/localhost.pem
```

### 2. Use the UI

1. Log in.
2. Select an environment (the live stream connects only when one is selected).
3. Open the **notifications** bell — green dot when connected; audit events appear as they arrive.
4. Open **Menu Publisher** — data refreshes on `menu-status-changed` via React Query invalidation (no polling).

### 3. Inspect the wire format

1. DevTools → **Network**
2. Find `/api/dev/live-events`
3. Chrome → **EventStream** tab for a live event list

Dev-only mock (not served in production):

```text
/api/dev/live-events?environmentKind=<kind>
```

If `NEXT_PUBLIC_LIVE_EVENTS_URL` is set, the app uses that URL template instead of the local mock.

---

## Quick reference

| Goal | Command / path |
|------|----------------|
| UI harness | `pnpm example:harness` in `sse-client` |
| Harness URL | http://localhost:5173/ |
| Harness stream (same origin) | http://localhost:5173/stream |
| Harness source | `examples/harness/` |
| Standalone mock (curl) | `pnpm example:mock-server` → http://127.0.0.1:4310/stream |
| Raw stream via curl | `curl -N http://127.0.0.1:4310/stream` (or `:5173/stream` while harness runs) |
| App UI | `pnpm dev` in `lce-menu-admin-ui` |
| In-app mock | `/api/dev/live-events` |
| Event contract | [EVENTS_CONTRACT.md](./EVENTS_CONTRACT.md) |
| System overview | [SYSTEM_OVERVIEW.md](./SYSTEM_OVERVIEW.md) |
