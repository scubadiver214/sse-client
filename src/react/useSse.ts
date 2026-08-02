import { useEffect, useMemo, useState } from 'react';

import { SseClient } from '../SseClient';
import type { SseClientError, SseClientOptions, SseConnectionState, SseEventMap } from '../types';
import { acquireSseClient, releaseSseClient } from './registry';

export interface UseSseOptions<TEventMap extends SseEventMap> extends SseClientOptions<TEventMap> {
  /**
   * Registry key used to share one underlying connection across every
   * `useSse` call site that passes the same key. Defaults to `String(url)`,
   * so pointing two components at the same URL automatically shares a
   * connection; pass an explicit key to force isolation or sharing.
   */
  key?: string;
}

export interface UseSseResult<TEventMap extends SseEventMap> {
  /** The underlying client, or `null` while disabled/disconnected. Pass to {@link useSseEvent}. */
  client: SseClient<TEventMap> | null;
  state: SseConnectionState;
  /** Most recent transport/parse error, if any. Cleared on the next successful open. */
  error: SseClientError | null;
}

/**
 * Opens (and shares) a connection to an SSE endpoint for the lifetime of the
 * component. Pass `null` instead of options to stay disconnected (e.g. while
 * a required parameter like an environment or auth token isn't ready yet) —
 * mirrors the `enabled` pattern used by this codebase's `react-query` hooks.
 *
 * Returns the connection state and the client itself; use {@link useSseEvent}
 * to subscribe to specific event types on that client.
 */
export function useSse<TEventMap extends SseEventMap = SseEventMap>(options: UseSseOptions<TEventMap> | null): UseSseResult<TEventMap> {
  const key = options ? options.key ?? String(options.url) : null;
  const [state, setState] = useState<SseConnectionState>('idle');
  const [error, setError] = useState<SseClientError | null>(null);

  // `options` intentionally isn't a dependency here beyond `key`: reconnecting on every
  // render (e.g. when callers pass an inline object literal) would defeat connection
  // sharing. Callers who need different behavior per URL should vary `key` accordingly.
  const client = useMemo(() => {
    if (!options || !key) {
      return null;
    }
    return acquireSseClient(key, () => new SseClient<TEventMap>(options));
    // `options` is intentionally omitted from deps; see the comment above.
  }, [key]);

  useEffect(() => {
    if (!client || !key) {
      setState('idle');
      setError(null);
      return;
    }

    setState(client.getState());
    setError(null);

    const unsubscribeState = client.onStateChange((next) => {
      setState(next);
      if (next === 'open') {
        setError(null);
      }
    });
    const unsubscribeError = client.onError(setError);

    client.connect();

    return () => {
      unsubscribeState();
      unsubscribeError();
      releaseSseClient(key);
    };
  }, [client, key]);

  return { client, state, error };
}
