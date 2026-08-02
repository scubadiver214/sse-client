import { ReconnectBackoff } from './backoff';
import { SseStreamParser } from './parseEventStream';
import { SseClientError } from './types';
import type { SseClientOptions, SseConnectionState, SseEventMap, SseEventMeta, SseListener, SseWildcardListener } from './types';

const WILDCARD = '*' as const;

type AnyListener = SseListener<unknown> | SseWildcardListener;

/**
 * Transport-agnostic, typed pub/sub client for Server-Sent Events streams.
 *
 * Reads the response body via `fetch` + `ReadableStream` (rather than the
 * native `EventSource`) so it can attach custom headers, run outside the
 * browser, and control reconnection/backoff precisely. Consumers subscribe by
 * event name — the `event:` field in the wire format — so a single
 * connection can multiplex arbitrarily many independent event types, and any
 * number of unrelated features can subscribe/unsubscribe without knowing
 * about each other.
 *
 * This class has no framework dependency; see `@mmozer/sse-client/react` for
 * React bindings.
 */
export class SseClient<TEventMap extends SseEventMap = SseEventMap> {
  private readonly options: SseClientOptions<TEventMap>;
  private readonly listeners = new Map<string, Set<AnyListener>>();
  private readonly stateListeners = new Set<(state: SseConnectionState) => void>();
  private readonly errorListeners = new Set<(error: SseClientError) => void>();
  private readonly backoff: ReconnectBackoff;
  private readonly fetchImpl: typeof fetch;

  private state: SseConnectionState = 'idle';
  private abortController: AbortController | null = null;
  private lastEventId: string | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingWaitResolve: (() => void) | null = null;
  private stopped = true;
  private generation = 0;

  constructor(options: SseClientOptions<TEventMap>) {
    this.options = options;
    this.lastEventId = options.lastEventId;
    this.backoff = new ReconnectBackoff(options.reconnect);
    // Bind fetch — calling an unbound `window.fetch` throws "Illegal invocation" in browsers.
    const resolvedFetch = options.fetch ?? globalThis.fetch?.bind(globalThis);
    this.fetchImpl = resolvedFetch;

    if (!this.fetchImpl) {
      throw new SseClientError('network-error', 'No `fetch` implementation available; pass one via `options.fetch`.');
    }
  }

  /** Current lifecycle state. */
  getState(): SseConnectionState {
    return this.state;
  }

  /** Opens the connection (idempotent while already connecting/open). Fire-and-forget; use `onStateChange` to observe progress. */
  connect(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.generation += 1;
    void this.runConnectionLoop(this.generation);
  }

  /** Closes the connection and cancels any pending reconnect. Safe to call multiple times. */
  disconnect(): void {
    this.stopped = true;
    this.generation += 1;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pendingWaitResolve) {
      this.pendingWaitResolve();
      this.pendingWaitResolve = null;
    }
    this.abortController?.abort();
    this.abortController = null;
    this.setState('closed');
  }

  /** Subscribes to a named event. Returns an unsubscribe function. */
  on<K extends keyof TEventMap & string>(event: K, listener: SseListener<TEventMap[K]>): () => void;
  on(event: typeof WILDCARD, listener: SseWildcardListener): () => void;
  on(event: string, listener: AnyListener): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => this.off(event, listener);
  }

  /** Subscribes to a named event for a single invocation, then automatically unsubscribes. */
  once<K extends keyof TEventMap & string>(event: K, listener: SseListener<TEventMap[K]>): () => void {
    const unsubscribe = this.on(event, ((payload: TEventMap[K], meta: SseEventMeta) => {
      unsubscribe();
      listener(payload, meta);
    }) as SseListener<TEventMap[K]>);
    return unsubscribe;
  }

  /** Removes a previously registered listener. */
  off(event: string, listener: AnyListener): void {
    this.listeners.get(event)?.delete(listener);
  }

  /** Subscribes to connection state transitions. Returns an unsubscribe function. */
  onStateChange(listener: (state: SseConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /** Subscribes to transport/parse errors. Returns an unsubscribe function. */
  onError(listener: (error: SseClientError) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  /** The most recently observed `id:` field, usable to manually resume a stream elsewhere. */
  getLastEventId(): string | undefined {
    return this.lastEventId;
  }

  private setState(state: SseConnectionState): void {
    if (this.state === state) {
      return;
    }
    this.state = state;
    this.options.onStateChange?.(state);
    for (const listener of this.stateListeners) {
      listener(state);
    }
  }

  private emitError(error: SseClientError): void {
    this.options.onError?.(error);
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }

  private dispatch(event: string, raw: string, meta: SseEventMeta): void {
    let payload: unknown = raw;
    try {
      payload = this.options.parse ? this.options.parse(event, raw) : (JSON.parse(raw) as unknown);
    } catch (cause) {
      this.emitError(new SseClientError('parse-error', `Failed to parse SSE payload for event "${event}"`, { cause }));
      return;
    }

    const notify = (invoke: () => void): void => {
      try {
        invoke();
      } catch (cause) {
        // Isolate consumer bugs so one handler cannot tear down the shared stream.
        this.emitError(new SseClientError('listener-error', `SSE listener for event "${event}" threw`, { cause }));
      }
    };

    this.listeners.get(event)?.forEach((listener) => {
      notify(() => (listener as SseListener<unknown>)(payload, meta));
    });
    this.listeners.get(WILDCARD)?.forEach((listener) => {
      notify(() => (listener as SseWildcardListener)(payload, meta));
    });
  }

  private async resolveHeaders(): Promise<Headers> {
    const headers = new Headers();
    headers.set('Accept', 'text/event-stream');

    const configured = this.options.headers;
    const resolved = typeof configured === 'function' ? await configured() : configured;
    for (const [key, value] of Object.entries(resolved ?? {})) {
      headers.set(key, value);
    }

    if (this.lastEventId) {
      headers.set('Last-Event-ID', this.lastEventId);
    }

    return headers;
  }

  private async runConnectionLoop(generation: number): Promise<void> {
    /** Counts consecutive *failed* connection attempts; reset after a successful open. */
    let consecutiveFailures = 0;
    const maxAttempts = this.options.reconnect?.maxAttempts ?? Number.POSITIVE_INFINITY;
    let hasOpenedOnce = false;

    while (!this.stopped && generation === this.generation) {
      this.setState(hasOpenedOnce || consecutiveFailures > 0 ? 'reconnecting' : 'connecting');

      try {
        await this.openOnce(generation);
        // Stream ended normally (server closed it). Treat as a disconnect worth retrying.
        if (this.stopped || generation !== this.generation) {
          return;
        }
        // Clean close after a live session — do not consume the failure budget.
        consecutiveFailures = 0;
        hasOpenedOnce = true;
      } catch (error) {
        if (this.stopped || generation !== this.generation) {
          return;
        }
        consecutiveFailures += 1;
        const clientError =
          error instanceof SseClientError ? error : new SseClientError('network-error', 'SSE connection failed', { cause: error });
        this.emitError(clientError);
      }

      if (this.stopped || generation !== this.generation) {
        return;
      }

      if (this.options.reconnect?.enabled === false || consecutiveFailures >= maxAttempts) {
        this.setState('failed');
        return;
      }

      const delayMs = this.backoff.nextDelayMs();
      await this.waitFor(delayMs);
    }
  }

  private waitFor(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      this.pendingWaitResolve = resolve;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.pendingWaitResolve = null;
        resolve();
      }, delayMs);
    });
  }

  private async openOnce(generation: number): Promise<void> {
    const abortController = new AbortController();
    this.abortController = abortController;

    const url = this.options.url;
    const headers = await this.resolveHeaders();

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers,
        credentials: this.options.credentials ?? 'same-origin',
        signal: abortController.signal,
      });
    } catch (cause) {
      if (abortController.signal.aborted) {
        throw new SseClientError('aborted', 'SSE request aborted');
      }
      throw new SseClientError('network-error', 'Failed to reach SSE endpoint', { cause });
    }

    if (!response.ok) {
      throw new SseClientError('http-error', `SSE endpoint responded with HTTP ${response.status}`, { status: response.status });
    }

    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.toLowerCase().includes('text/event-stream')) {
      throw new SseClientError('http-error', `SSE endpoint returned unexpected Content-Type: ${contentType}`, {
        status: response.status,
      });
    }

    if (!response.body) {
      throw new SseClientError('network-error', 'SSE response had no readable body');
    }

    this.setState('open');
    this.backoff.reset();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseStreamParser();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (generation !== this.generation) {
          return;
        }
        if (done) {
          for (const event of parser.flush()) {
            this.handleParsedEvent(event);
          }
          return;
        }

        const chunk = decoder.decode(value, { stream: true });
        for (const event of parser.push(chunk)) {
          this.handleParsedEvent(event);
        }
      }
    } catch (cause) {
      if (abortController.signal.aborted) {
        throw new SseClientError('aborted', 'SSE stream aborted');
      }
      throw new SseClientError('network-error', 'SSE stream read failed', { cause });
    } finally {
      reader.releaseLock();
    }
  }

  private handleParsedEvent(parsed: { event: string; data: string; id?: string; retryMs?: number }): void {
    if (parsed.id !== undefined) {
      this.lastEventId = parsed.id;
    }
    if (parsed.retryMs !== undefined) {
      this.backoff.setServerSuggestedDelay(parsed.retryMs);
    }
    this.dispatch(parsed.event, parsed.data, { event: parsed.event, id: parsed.id, raw: parsed.data });
  }
}

/** Convenience factory mirroring `new SseClient(options)`, useful for functional call sites. */
export function createSseClient<TEventMap extends SseEventMap = SseEventMap>(options: SseClientOptions<TEventMap>): SseClient<TEventMap> {
  return new SseClient<TEventMap>(options);
}
