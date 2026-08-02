import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SseClient } from '../SseClient';
import type { SseEventMap, SseEventMeta, SseListener } from '../types';
import { useSseEvent } from './useSseEvent';

type TestEvents = { ping: { at: number } };

afterEach(() => {
  cleanup();
});

/**
 * Minimal stand-in for `SseClient` that only implements the `on` surface
 * `useSseEvent` actually depends on, so these tests exercise the hook's
 * subscribe/unsubscribe contract without any real network transport.
 */
function createFakeClient<TEventMap extends SseEventMap>() {
  const listeners = new Map<string, Set<SseListener<unknown>>>();

  const fake = {
    on(event: string, listener: SseListener<unknown>) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(listener);
      return () => set?.delete(listener);
    },
  };

  return {
    client: fake as unknown as SseClient<TEventMap>,
    emit(event: string, payload: unknown, meta: Partial<SseEventMeta> = {}) {
      listeners.get(event)?.forEach((listener) => listener(payload, { event, raw: JSON.stringify(payload), ...meta }));
    },
  };
}

describe('useSseEvent', () => {
  it('invokes the handler when the client emits a matching event', () => {
    const { client, emit } = createFakeClient<TestEvents>();
    const handler = vi.fn();

    renderHook(() => useSseEvent(client, 'ping', handler));
    emit('ping', { at: 1 });

    expect(handler).toHaveBeenCalledWith({ at: 1 }, expect.objectContaining({ event: 'ping' }));
  });

  it('always calls the latest handler closure without re-subscribing', () => {
    const { client, emit } = createFakeClient<TestEvents>();
    const first = vi.fn();
    const second = vi.fn();

    const { rerender } = renderHook(({ handler }) => useSseEvent(client, 'ping', handler), { initialProps: { handler: first } });
    rerender({ handler: second });
    emit('ping', { at: 2 });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ at: 2 }, expect.objectContaining({ event: 'ping' }));
  });

  it('does nothing when client is null or undefined', () => {
    const handler = vi.fn();
    expect(() => renderHook(() => useSseEvent(null, 'ping', handler))).not.toThrow();
  });

  it('unsubscribes on unmount so the handler stops firing', () => {
    const { client, emit } = createFakeClient<TestEvents>();
    const handler = vi.fn();

    const { unmount } = renderHook(() => useSseEvent(client, 'ping', handler));
    unmount();
    emit('ping', { at: 3 });

    expect(handler).not.toHaveBeenCalled();
  });
});
