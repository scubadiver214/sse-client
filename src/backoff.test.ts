import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReconnectBackoff } from './backoff';

describe('ReconnectBackoff', () => {
  beforeEach(() => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('grows delays exponentially by the configured factor', () => {
    const backoff = new ReconnectBackoff({ initialDelayMs: 100, factor: 2, jitter: false, maxDelayMs: 100_000 });

    expect(backoff.nextDelayMs()).toBe(100);
    expect(backoff.nextDelayMs()).toBe(200);
    expect(backoff.nextDelayMs()).toBe(400);
  });

  it('caps delays at maxDelayMs', () => {
    const backoff = new ReconnectBackoff({ initialDelayMs: 1000, factor: 10, jitter: false, maxDelayMs: 5000 });

    backoff.nextDelayMs(); // 1000
    backoff.nextDelayMs(); // would be 10000, capped to 5000
    expect(backoff.nextDelayMs()).toBe(5000);
  });

  it('applies +/-25% jitter around the base delay', () => {
    const backoff = new ReconnectBackoff({ initialDelayMs: 1000, jitter: true, maxDelayMs: 100_000 });

    // Math.random mocked to 0.5 => midpoint of the jitter range => exactly the base delay.
    expect(backoff.nextDelayMs()).toBe(1000);
  });

  it('prefers a server-suggested retry delay over the computed exponential value', () => {
    const backoff = new ReconnectBackoff({ initialDelayMs: 1000, jitter: false });
    backoff.setServerSuggestedDelay(15_000);

    expect(backoff.nextDelayMs()).toBe(15_000);
  });

  it('tracks attempt count and resets it', () => {
    const backoff = new ReconnectBackoff({ jitter: false });

    backoff.nextDelayMs();
    backoff.nextDelayMs();
    expect(backoff.attemptCount).toBe(2);

    backoff.reset();
    expect(backoff.attemptCount).toBe(0);
  });

  it('reports exhausted once maxAttempts is reached', () => {
    const backoff = new ReconnectBackoff({ maxAttempts: 2, jitter: false });

    expect(backoff.exhausted).toBe(false);
    backoff.nextDelayMs();
    expect(backoff.exhausted).toBe(false);
    backoff.nextDelayMs();
    expect(backoff.exhausted).toBe(true);
  });
});
