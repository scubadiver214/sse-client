import { useEffect, useMemo, useRef, useState } from 'react';
import { useSse } from '@mmozer/sse-client/react';
import type { SseConnectionState, SseEventMeta } from '@mmozer/sse-client';

type HarnessEvents = {
  'audit-event': {
    eventId: number;
    action: 'I' | 'U' | 'D';
    tableName: string;
    schemaName: string;
    changedFields: string[];
    eventTimeUtc: string;
  };
  'menu-status-changed': {
    locationNumber: number;
    environmentKind: string;
    processing: boolean;
    publishCompleted: boolean;
    updatedAtUtc: string;
  };
};

type FeedItem = {
  key: string;
  receivedAt: number;
  event: string;
  id?: string;
  payload: unknown;
};

const MAX_FEED = 100;
/** Same-origin stream served by `sseMockPlugin` inside the Vite dev server. */
const STREAM_URL = '/stream';

const STATE_LABEL: Record<SseConnectionState, string> = {
  idle: 'Idle',
  connecting: 'Connecting',
  open: 'Live',
  reconnecting: 'Reconnecting',
  closed: 'Closed',
  failed: 'Failed',
};

export function App() {
  const [enabled, setEnabled] = useState(true);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState<'all' | 'audit-event' | 'menu-status-changed'>('all');
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [lastEventId, setLastEventId] = useState<string | undefined>();
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const { client, state, error } = useSse<HarnessEvents>(
    enabled
      ? {
          url: STREAM_URL,
          credentials: 'omit',
          reconnect: { initialDelayMs: 1000, maxDelayMs: 10_000 },
        }
      : null
  );

  useEffect(() => {
    if (!client) {
      return;
    }
    return client.on('*', (payload: unknown, meta: SseEventMeta) => {
      if (pausedRef.current) {
        return;
      }
      if (meta.id) {
        setLastEventId(meta.id);
      }
      setFeed((prev) =>
        [
          {
            key: `${meta.id ?? 'no-id'}-${meta.event}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            receivedAt: Date.now(),
            event: meta.event,
            id: meta.id,
            payload,
          },
          ...prev,
        ].slice(0, MAX_FEED)
      );
    });
  }, [client]);

  const visible = useMemo(
    () => (filter === 'all' ? feed : feed.filter((item) => item.event === filter)),
    [feed, filter]
  );

  const counts = useMemo(() => {
    let audit = 0;
    let menu = 0;
    for (const item of feed) {
      if (item.event === 'audit-event') {
        audit += 1;
      } else if (item.event === 'menu-status-changed') {
        menu += 1;
      }
    }
    return { audit, menu, total: feed.length };
  }, [feed]);

  return (
    <div className="page">
      <div className="atmosphere" aria-hidden="true" />

      <header className="hero">
        <p className="brand">@mmozer/sse-client</p>
        <h1>UI test harness</h1>
        <p className="lede">
          Live view of the mock contract stream — same client hooks the app uses, no login required.
        </p>
      </header>

      <section className="toolbar" aria-label="Connection controls">
        <div className={`status status-${state}`}>
          <span className="status-dot" />
          <span>{STATE_LABEL[state]}</span>
          {lastEventId ? <span className="muted">last id {lastEventId}</span> : null}
        </div>

        <div className="actions">
          <button type="button" className={enabled ? 'danger' : 'primary'} onClick={() => setEnabled((v) => !v)}>
            {enabled ? 'Disconnect' : 'Connect'}
          </button>
          <button type="button" onClick={() => setPaused((v) => !v)} disabled={!enabled}>
            {paused ? 'Resume feed' : 'Pause feed'}
          </button>
          <button type="button" onClick={() => setFeed([])} disabled={feed.length === 0}>
            Clear
          </button>
        </div>
      </section>

      {error ? (
        <p className="banner error" role="alert">
          {error.reason}: {error.message}
        </p>
      ) : null}

      {paused ? (
        <p className="banner warn" role="status">
          Feed paused — connection stays open; new events are dropped until you resume.
        </p>
      ) : null}

      <section className="filters" aria-label="Event filters">
        <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
          All <span>{counts.total}</span>
        </button>
        <button
          type="button"
          className={filter === 'audit-event' ? 'active' : ''}
          onClick={() => setFilter('audit-event')}
        >
          audit-event <span>{counts.audit}</span>
        </button>
        <button
          type="button"
          className={filter === 'menu-status-changed' ? 'active' : ''}
          onClick={() => setFilter('menu-status-changed')}
        >
          menu-status-changed <span>{counts.menu}</span>
        </button>
      </section>

      <main className="feed" aria-live="polite">
        {visible.length === 0 ? (
          <div className="empty">
            <p>{enabled ? 'Waiting for the next event…' : 'Connect to start the stream.'}</p>
            <p className="muted">
              Stream URL: <code>{STREAM_URL}</code> (same origin as this page — no separate mock port needed).
            </p>
          </div>
        ) : (
          visible.map((item) => <EventCard key={item.key} item={item} />)
        )}
      </main>
    </div>
  );
}

function EventCard({ item }: { item: FeedItem }) {
  const time = new Date(item.receivedAt).toLocaleTimeString();
  const summary = summarize(item.event, item.payload);

  return (
    <article className={`card event-${item.event}`}>
      <header>
        <span className="event-name">{item.event}</span>
        <span className="meta">
          {item.id ? `id ${item.id}` : 'no id'} · {time}
        </span>
      </header>
      <p className="summary">{summary}</p>
      <pre>{JSON.stringify(item.payload, null, 2)}</pre>
    </article>
  );
}

function summarize(event: string, payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return String(payload);
  }
  const data = payload as Record<string, unknown>;
  if (event === 'audit-event') {
    return `${String(data.action)} on ${String(data.schemaName)}.${String(data.tableName)}`;
  }
  if (event === 'menu-status-changed') {
    const processing = data.processing ? 'processing' : 'idle';
    const published = data.publishCompleted ? ', publish completed' : '';
    return `Location ${String(data.locationNumber)} · ${processing}${published}`;
  }
  return event;
}
