import { afterEach, describe, expect, it, vi } from 'vitest';

import { SseClient } from './SseClient';
import { SseClientError } from './types';

type TestEvents = {
  greeting: { message: string };
  ping: { at: number };
};

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    },
  });
}

function okResponse(chunks: string[]): Response {
  return new Response(streamFromChunks(chunks), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('SseClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('dispatches events to listeners registered for that event name', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(['event: greeting\ndata: {"message":"hi"}\n\n']));
    const client = new SseClient<TestEvents>({ url: 'https://example.test/stream', fetch: fetchMock, reconnect: { enabled: false } });

    const received: TestEvents['greeting'][] = [];
    client.on('greeting', (payload) => received.push(payload));
    client.connect();

    await vi.waitFor(() => expect(received).toEqual([{ message: 'hi' }]));
    client.disconnect();
  });

  it('does not deliver events to listeners of a different event name', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(['event: ping\ndata: {"at":1}\n\n']));
    const client = new SseClient<TestEvents>({ url: 'https://example.test/stream', fetch: fetchMock, reconnect: { enabled: false } });

    const greetingListener = vi.fn();
    const pingListener = vi.fn();
    client.on('greeting', greetingListener);
    client.on('ping', pingListener);
    client.connect();

    await vi.waitFor(() => expect(pingListener).toHaveBeenCalledTimes(1));
    expect(greetingListener).not.toHaveBeenCalled();
    client.disconnect();
  });

  it('delivers every event to wildcard listeners regardless of name', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse(['event: greeting\ndata: {"message":"hi"}\n\nevent: ping\ndata: {"at":1}\n\n']));
    const client = new SseClient<TestEvents>({ url: 'https://example.test/stream', fetch: fetchMock, reconnect: { enabled: false } });

    const wildcard = vi.fn();
    client.on('*', wildcard);
    client.connect();

    await vi.waitFor(() => expect(wildcard).toHaveBeenCalledTimes(2));
    client.disconnect();
  });

  it('once() auto-unsubscribes after the first matching event', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse(['event: ping\ndata: {"at":1}\n\nevent: ping\ndata: {"at":2}\n\n']));
    const client = new SseClient<TestEvents>({ url: 'https://example.test/stream', fetch: fetchMock, reconnect: { enabled: false } });

    const listener = vi.fn();
    client.once('ping', listener);
    client.connect();

    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    expect(listener).toHaveBeenCalledWith({ at: 1 }, expect.objectContaining({ event: 'ping' }));
    client.disconnect();
  });

  it('off() removes a previously registered listener', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(['event: ping\ndata: {"at":1}\n\n']));
    const client = new SseClient<TestEvents>({ url: 'https://example.test/stream', fetch: fetchMock, reconnect: { enabled: false } });

    const listener = vi.fn();
    client.on('ping', listener);
    client.off('ping', listener);
    client.connect();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(listener).not.toHaveBeenCalled();
    client.disconnect();
  });

  it('transitions through connecting -> open and reports state changes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(['event: ping\ndata: {"at":1}\n\n']));
    const client = new SseClient<TestEvents>({ url: 'https://example.test/stream', fetch: fetchMock, reconnect: { enabled: false } });

    const states: string[] = [];
    client.onStateChange((state) => states.push(state));
    client.connect();

    await vi.waitFor(() => expect(states).toContain('open'));
    expect(states[0]).toBe('connecting');
    client.disconnect();
    expect(client.getState()).toBe('closed');
  });

  it('surfaces an SseClientError with reason "http-error" on non-2xx responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    const client = new SseClient<TestEvents>({ url: 'https://example.test/stream', fetch: fetchMock, reconnect: { enabled: false } });

    const onError = vi.fn();
    client.onError(onError);
    client.connect();

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    const error = onError.mock.calls[0]?.[0] as SseClientError;
    expect(error).toBeInstanceOf(SseClientError);
    expect(error.reason).toBe('http-error');
    expect(error.status).toBe(401);
    await vi.waitFor(() => expect(client.getState()).toBe('failed'));
  });

  it('reconnects with the last received Last-Event-ID after a dropped connection', async () => {
    vi.useFakeTimers();

    let call = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return Promise.resolve(okResponse(['id: 7\nevent: ping\ndata: {"at":1}\n\n']));
      }
      return Promise.resolve(okResponse(['event: ping\ndata: {"at":2}\n\n']));
    });

    const client = new SseClient<TestEvents>({
      url: 'https://example.test/stream',
      fetch: fetchMock,
      reconnect: { enabled: true, initialDelayMs: 1000, jitter: false },
    });

    client.connect();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(1500);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const secondCallHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Headers;
    expect(secondCallHeaders.get('Last-Event-ID')).toBe('7');

    client.disconnect();
  });

  it('stops retrying once maxAttempts is exhausted and reports state "failed"', async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    const client = new SseClient<TestEvents>({
      url: 'https://example.test/stream',
      fetch: fetchMock,
      reconnect: { enabled: true, initialDelayMs: 10, maxDelayMs: 10, jitter: false, maxAttempts: 2 },
    });

    client.connect();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(20);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(20);

    await vi.waitFor(() => expect(client.getState()).toBe('failed'));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    client.disconnect();
  });

  it('disconnect() aborts the in-flight request and prevents further event dispatch', async () => {
    const abortSpy = vi.fn();
    const fetchMock = vi.fn().mockImplementation((_url: string, init: { signal: AbortSignal }) => {
      init.signal.addEventListener('abort', abortSpy);
      return new Promise<Response>(() => {
        /* never resolves, simulating an open long-lived connection */
      });
    });

    const client = new SseClient<TestEvents>({ url: 'https://example.test/stream', fetch: fetchMock, reconnect: { enabled: false } });
    client.connect();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    client.disconnect();

    expect(abortSpy).toHaveBeenCalledTimes(1);
    expect(client.getState()).toBe('closed');
  });
});
