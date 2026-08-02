import { StrictMode } from 'react';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSse } from './useSse';
import { __resetSseClientRegistryForTests } from './registry';

type TestEvents = { ping: { at: number } };

/**
 * Builds a response whose body stays open after delivering `chunks` (never
 * calls `controller.close()`), simulating a live SSE connection that is
 * still connected but idle \u2014 as opposed to one where the server has hung up.
 */
function openResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index += 1;
      }
      // No more chunks queued yet, and the stream is intentionally left open.
    },
  });
  return new Response(stream, { status: 200 });
}

afterEach(() => {
  cleanup();
  __resetSseClientRegistryForTests();
  vi.restoreAllMocks();
});

describe('useSse', () => {
  it('stays idle with a null client when options are null', () => {
    const { result } = renderHook(() => useSse(null));

    expect(result.current.client).toBeNull();
    expect(result.current.state).toBe('idle');
  });

  it('connects and transitions to "open" once the stream responds', async () => {
    const fetchMock = vi.fn().mockResolvedValue(openResponse(['event: ping\ndata: {"at":1}\n\n']));

    const { result } = renderHook(() =>
      useSse<TestEvents>({ url: 'https://example.test/stream', fetch: fetchMock, reconnect: { enabled: false } })
    );

    await waitFor(() => expect(result.current.state).toBe('open'));
    expect(result.current.client).not.toBeNull();
  });

  it('shares one underlying connection across multiple hook instances with the same key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(openResponse(['event: ping\ndata: {"at":1}\n\n']));
    const options = { url: 'https://example.test/shared', fetch: fetchMock, reconnect: { enabled: false } } as const;

    const first = renderHook(() => useSse<TestEvents>(options));
    const second = renderHook(() => useSse<TestEvents>(options));

    await waitFor(() => expect(first.result.current.state).toBe('open'));
    await waitFor(() => expect(second.result.current.state).toBe('open'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.result.current.client).toBe(second.result.current.client);
  });

  it('disconnects only after the last subscriber unmounts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(openResponse(['event: ping\ndata: {"at":1}\n\n']));
    const options = { url: 'https://example.test/refcount', fetch: fetchMock, reconnect: { enabled: false } } as const;

    const first = renderHook(() => useSse<TestEvents>(options));
    const second = renderHook(() => useSse<TestEvents>(options));

    await waitFor(() => expect(first.result.current.state).toBe('open'));
    const sharedClient = first.result.current.client;

    first.unmount();
    expect(sharedClient?.getState()).toBe('open');

    second.unmount();
    expect(sharedClient?.getState()).toBe('closed');
  });

  it('surfaces transport errors via the error field', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));

    const { result } = renderHook(() =>
      useSse<TestEvents>({ url: 'https://example.test/error', fetch: fetchMock, reconnect: { enabled: false } })
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.reason).toBe('http-error');
  });

  it('disconnects after unmount under React Strict Mode (no leaked connection)', async () => {
    // Fresh Response per fetch — a single Response body can only be read once, and
    // Strict Mode's mount/cleanup/remount cycle connects twice during setup.
    const fetchMock = vi.fn().mockImplementation(() => openResponse(['event: ping\ndata: {"at":1}\n\n']));

    const { result, unmount } = renderHook(
      () =>
        useSse<TestEvents>({
          url: 'https://example.test/strict',
          fetch: fetchMock,
          reconnect: { enabled: false },
        }),
      { wrapper: StrictMode }
    );

    await waitFor(() => expect(result.current.state).toBe('open'));
    const client = result.current.client;
    expect(client).not.toBeNull();

    unmount();
    expect(client?.getState()).toBe('closed');
  });
});
