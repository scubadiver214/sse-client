import type { BackoffOptions } from './backoff';

/** Lifecycle states exposed to consumers, independent of transport details. */
export type SseConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'failed';

/** Discriminates the reason a client transitions to `failed`/emits an error. */
export type SseErrorReason = 'http-error' | 'network-error' | 'parse-error' | 'aborted';

export class SseClientError extends Error {
  readonly reason: SseErrorReason;
  readonly status?: number;
  readonly cause?: unknown;

  constructor(reason: SseErrorReason, message: string, options?: { status?: number; cause?: unknown }) {
    super(message);
    this.name = 'SseClientError';
    this.reason = reason;
    this.status = options?.status;
    this.cause = options?.cause;
  }
}

/**
 * Maps event names (the SSE `event:` field) to their decoded payload type.
 * Consumers define their own map so `on`/`off` calls are fully typed and one
 * client instance can carry many unrelated event types side by side, e.g.:
 *
 * ```ts
 * type AppEvents = {
 *   'audit-event': AuditEvent;
 *   'menu-status-changed': MenuStatusChangedEvent;
 * };
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SseEventMap = Record<string, any>;

export interface SseEventMeta {
  /** The raw `event:` field name (defaults to `"message"` when the server omits it). */
  event: string;
  /** The `id:` field, if the server sent one. */
  id?: string;
  /** Raw, unparsed `data:` payload, exposed for consumers that need it (e.g. logging). */
  raw: string;
}

export type SseListener<TPayload> = (payload: TPayload, meta: SseEventMeta) => void;

/** Emitted on the reserved `'*'` channel for every event, regardless of name. */
export interface SseWildcardListener {
  (payload: unknown, meta: SseEventMeta): void;
}

export interface SseClientOptions<TEventMap extends SseEventMap = SseEventMap> {
  /** Absolute or relative URL of the `text/event-stream` endpoint. */
  url: string | URL;
  /**
   * Extra request headers. Unlike the native `EventSource`, the fetch-based
   * transport supports arbitrary headers (e.g. bearer tokens) in addition to cookies.
   */
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  /** Forwarded to `fetch`'s `credentials` option. Defaults to `'same-origin'`. */
  credentials?: RequestCredentials;
  /** Resume from a specific `Last-Event-ID`. Overridden automatically once events arrive. */
  lastEventId?: string;
  /** Decodes a raw `data:` string for a given event name. Defaults to `JSON.parse`. */
  parse?: <K extends keyof TEventMap>(event: K, raw: string) => TEventMap[K];
  /** Reconnection/backoff tuning. Set `enabled: false` to disable automatic reconnects entirely. */
  reconnect?: BackoffOptions & { enabled?: boolean };
  /** Injectable `fetch` implementation (useful in tests or non-browser runtimes). */
  fetch?: typeof fetch;
  /** Called whenever the connection state changes. */
  onStateChange?: (state: SseConnectionState) => void;
  /** Called for every transport/parse error, whether or not a reconnect will follow. */
  onError?: (error: SseClientError) => void;
}
