import { useEffect, useRef } from 'react';

import type { SseClient } from '../SseClient';
import type { SseEventMap, SseListener } from '../types';

/**
 * Subscribes `handler` to a named event on `client` for as long as the
 * component is mounted. `client` is typically the result of {@link useSse};
 * pass `null`/`undefined` to skip subscribing (e.g. while disconnected).
 *
 * `handler` is always invoked with its latest closure without re-subscribing
 * on every render, so consumers can pass an inline arrow function safely.
 */
export function useSseEvent<TEventMap extends SseEventMap, K extends keyof TEventMap & string>(
  client: SseClient<TEventMap> | null | undefined,
  event: K,
  handler: SseListener<TEventMap[K]>
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!client) {
      return;
    }
    return client.on(event, (payload, meta) => handlerRef.current(payload, meta));
  }, [client, event]);
}
