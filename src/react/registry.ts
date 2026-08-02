import type { SseClient } from '../SseClient';
import type { SseEventMap } from '../types';

/**
 * Refcounted registry so multiple independent components subscribing to the
 * same logical stream (same registry key, e.g. the endpoint URL) share one
 * underlying HTTP connection instead of each opening their own. The last
 * consumer to unmount tears the connection down.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const registry = new Map<string, { client: SseClient<any>; refCount: number }>();

export function acquireSseClient<TEventMap extends SseEventMap>(key: string, factory: () => SseClient<TEventMap>): SseClient<TEventMap> {
  let entry = registry.get(key);
  if (!entry) {
    entry = { client: factory(), refCount: 0 };
    registry.set(key, entry);
  }
  entry.refCount += 1;
  return entry.client as SseClient<TEventMap>;
}

export function releaseSseClient(key: string): void {
  const entry = registry.get(key);
  if (!entry) {
    return;
  }
  entry.refCount -= 1;
  if (entry.refCount <= 0) {
    entry.client.disconnect();
    registry.delete(key);
  }
}

/** Test-only escape hatch to reset shared connection state between test cases. */
export function __resetSseClientRegistryForTests(): void {
  for (const entry of registry.values()) {
    entry.client.disconnect();
  }
  registry.clear();
}
