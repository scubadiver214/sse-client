/**
 * Streaming parser for the `text/event-stream` wire format (WHATWG HTML spec,
 * "9.2.6 Parsing an event stream"). Consumes raw text chunks as they arrive
 * over the network and yields fully-formed events as soon as each event's
 * terminating blank line is seen, without waiting for the whole response.
 */

export interface ParsedSseEvent {
  /** Event name from the `event:` field. Defaults to `"message"` per spec. */
  event: string;
  /** Joined `data:` field lines (newline-separated), unparsed. */
  data: string;
  /** `id:` field, if present. Callers should track the last seen id for resumption. */
  id?: string;
  /** `retry:` field in milliseconds, if the server requested a specific reconnect delay. */
  retryMs?: number;
}

const DEFAULT_EVENT_NAME = 'message';

/**
 * Incrementally parses an SSE byte/text stream. Feed it decoded text chunks via
 * {@link push}; it buffers partial lines/events internally and returns complete
 * events as they become available. Call {@link flush} at stream end in case the
 * server omitted a trailing blank line.
 */
export class SseStreamParser {
  private buffer = '';
  private eventName = DEFAULT_EVENT_NAME;
  private dataLines: string[] = [];
  private lastId: string | undefined;
  private pendingRetryMs: number | undefined;

  /** Feeds a raw text chunk (already UTF-8 decoded) and returns any completed events. */
  push(chunk: string): ParsedSseEvent[] {
    this.buffer += chunk;
    const events: ParsedSseEvent[] = [];

    // Normalize line endings, then split into lines while retaining the ability to
    // hold back a trailing partial line that hasn't been terminated yet.
    this.buffer = this.buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      const event = this.consumeLine(line);
      if (event) {
        events.push(event);
      }
      newlineIndex = this.buffer.indexOf('\n');
    }

    return events;
  }

  /** Call once the underlying stream ends; emits a final pending event if one was mid-flight. */
  flush(): ParsedSseEvent[] {
    const events: ParsedSseEvent[] = [];
    if (this.buffer.length > 0) {
      const event = this.consumeLine(this.buffer);
      this.buffer = '';
      if (event) {
        events.push(event);
      }
    }
    if (this.dataLines.length > 0) {
      const event = this.dispatchEvent();
      if (event) {
        events.push(event);
      }
    }
    return events;
  }

  /** The most recent event id observed, for Last-Event-ID resumption on reconnect. */
  getLastEventId(): string | undefined {
    return this.lastId;
  }

  private consumeLine(line: string): ParsedSseEvent | null {
    if (line === '') {
      return this.dispatchEvent();
    }

    if (line.startsWith(':')) {
      // Comment line; used by servers as a keep-alive heartbeat. Ignore.
      return null;
    }

    const colonIndex = line.indexOf(':');
    const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
    let value = colonIndex === -1 ? '' : line.slice(colonIndex + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }

    switch (field) {
      case 'event':
        this.eventName = value || DEFAULT_EVENT_NAME;
        break;
      case 'data':
        this.dataLines.push(value);
        break;
      case 'id':
        if (!value.includes('\u0000')) {
          this.lastId = value;
        }
        break;
      case 'retry':
        if (/^\d+$/.test(value)) {
          this.pendingRetryMs = Number(value);
        }
        break;
      default:
        // Unknown field per spec: ignore.
        break;
    }

    return null;
  }

  private dispatchEvent(): ParsedSseEvent | null {
    if (this.dataLines.length === 0) {
      // Spec: an event with no `data` field still resets event name buffering
      // but dispatches nothing.
      this.eventName = DEFAULT_EVENT_NAME;
      return null;
    }

    const event: ParsedSseEvent = {
      event: this.eventName,
      data: this.dataLines.join('\n'),
      id: this.lastId,
      retryMs: this.pendingRetryMs,
    };

    this.eventName = DEFAULT_EVENT_NAME;
    this.dataLines = [];
    this.pendingRetryMs = undefined;

    return event;
  }
}
