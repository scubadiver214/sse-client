import { useEffect, useRef, useState } from 'react';

import { SseClient } from '../SseClient';
import type { SseClientError, SseClientOptions, SseConnectionState, SseEventMap } from '../types';
import { acquireSseClient, releaseSseClient } from './registry';

export interface UseSseOptions<TEventMap extends SseEventMap> extends SseClientOptions<TEventMap> {
  /**
   * Registry key used to share one underlying connection across every
   * `useSse` call site that passes the same key. Defaults to `String(url)`,
   * so pointing two components at the same URL automatically shares a
   * connection; pass an explicit key to force isolation or sharing.
   *
   * The client is created once per key. If you change non-URL options that
   * must take effect on a new connection (e.g. static `headers` objects,
   * `parse`, or `reconnect` tuning), vary `key` (or `url`) so the registry
   * opens a fresh client. Prefer `headers` as a function if values change
   * over time without a reconnect.
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
  const key = options ? (options.key ?? String(options.url)) : null;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [client, setClient] = useState<SseClient<TEventMap> | null>(null);
  const [state, setState] = useState<SseConnectionState>('idle');
  const [error, setError] = useState<SseClientError | null>(null);

  // Acquire/release only in an effect so React Strict Mode's mount → cleanup →
  // remount cycle cannot leak a connection (refcount must not be bumped during render).
  useEffect(() => {
    const currentOptions = optionsRef.current;
    if (!key || !currentOptions) {
      setClient(null);
      setState('idle');
      setError(null);
      return;
    }

    const acquired = acquireSseClient(key, () => new SseClient<TEventMap>(currentOptions));
    setClient(acquired);
    setState(acquired.getState());
    setError(null);

    const unsubscribeState = acquired.onStateChange((next) => {
      setState(next);
      if (next === 'open') {
        setError(null);
      }
    });
    const unsubscribeError = acquired.onError(setError);

    acquired.connect();

    return () => {
      unsubscribeState();
      unsubscribeError();
      releaseSseClient(key);
      setClient(null);
    };
  }, [key]);

  return { client, state, error };
}
