import { describe, expect, it } from 'vitest';

import { SseStreamParser } from './parseEventStream';

describe('SseStreamParser', () => {
  it('parses a single complete event delivered in one chunk', () => {
    const parser = new SseStreamParser();
    const events = parser.push('event: greeting\ndata: hello\n\n');

    expect(events).toEqual([{ event: 'greeting', data: 'hello', id: undefined, retryMs: undefined }]);
  });

  it('defaults the event name to "message" when omitted', () => {
    const parser = new SseStreamParser();
    const events = parser.push('data: hello\n\n');

    expect(events[0]?.event).toBe('message');
  });

  it('joins multiple data lines with newlines', () => {
    const parser = new SseStreamParser();
    const events = parser.push('data: line one\ndata: line two\n\n');

    expect(events[0]?.data).toBe('line one\nline two');
  });

  it('buffers partial events across multiple chunks', () => {
    const parser = new SseStreamParser();
    expect(parser.push('event: partial\ndata: hel')).toEqual([]);
    const events = parser.push('lo\n\n');

    expect(events).toEqual([{ event: 'partial', data: 'hello', id: undefined, retryMs: undefined }]);
  });

  it('splits a single chunk containing multiple events', () => {
    const parser = new SseStreamParser();
    const events = parser.push('event: a\ndata: 1\n\nevent: b\ndata: 2\n\n');

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ event: 'a', data: '1' });
    expect(events[1]).toMatchObject({ event: 'b', data: '2' });
  });

  it('tracks the last id and exposes it via getLastEventId', () => {
    const parser = new SseStreamParser();
    parser.push('id: 42\ndata: hi\n\n');

    expect(parser.getLastEventId()).toBe('42');
  });

  it('carries the last id forward to events that do not redeclare it', () => {
    const parser = new SseStreamParser();
    const [first] = parser.push('id: 1\ndata: a\n\n');
    const [second] = parser.push('data: b\n\n');

    expect(first?.id).toBe('1');
    expect(second?.id).toBe('1');
  });

  it('parses a numeric retry field', () => {
    const parser = new SseStreamParser();
    const events = parser.push('retry: 5000\ndata: hi\n\n');

    expect(events[0]?.retryMs).toBe(5000);
  });

  it('ignores comment lines starting with a colon', () => {
    const parser = new SseStreamParser();
    const events = parser.push(': keep-alive\ndata: hi\n\n');

    expect(events).toHaveLength(1);
    expect(events[0]?.data).toBe('hi');
  });

  it('normalizes CRLF and lone CR line endings', () => {
    const parser = new SseStreamParser();
    const events = parser.push('data: hi\r\n\r\n');

    expect(events[0]?.data).toBe('hi');
  });

  it('emits nothing for a data-less dispatch (blank line with no data field)', () => {
    const parser = new SseStreamParser();
    const events = parser.push('event: noop\n\ndata: real\n\n');

    expect(events).toHaveLength(1);
    expect(events[0]?.data).toBe('real');
  });

  it('flush() emits a trailing event that never received its terminating blank line', () => {
    const parser = new SseStreamParser();
    parser.push('event: trailing\ndata: no-blank-line');

    expect(parser.flush()).toEqual([{ event: 'trailing', data: 'no-blank-line', id: undefined, retryMs: undefined }]);
  });
});
