export interface BackoffOptions {
  /** Delay before the first reconnect attempt, in ms. Default 1000. */
  initialDelayMs?: number;
  /** Upper bound for the computed delay, in ms. Default 30000. */
  maxDelayMs?: number;
  /** Multiplier applied to the delay after each attempt. Default 2. */
  factor?: number;
  /** Randomizes each delay within +/-25% to avoid thundering-herd reconnects. Default true. */
  jitter?: boolean;
  /** Maximum number of reconnect attempts before giving up. Default Infinity. */
  maxAttempts?: number;
}

const DEFAULTS: Required<BackoffOptions> = {
  initialDelayMs: 1000,
  maxDelayMs: 30_000,
  factor: 2,
  jitter: true,
  maxAttempts: Number.POSITIVE_INFINITY,
};

/**
 * Stateful exponential backoff calculator with optional jitter. Tracks the
 * current attempt count internally; call {@link reset} after a successful,
 * stable connection so the next disconnect starts back at the initial delay.
 */
export class ReconnectBackoff {
  private readonly options: Required<BackoffOptions>;
  private attempt = 0;
  private serverSuggestedDelayMs: number | undefined;

  constructor(options: BackoffOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  /** Records a server-sent `retry:` field to prefer on the next computed delay. */
  setServerSuggestedDelay(delayMs: number | undefined): void {
    this.serverSuggestedDelayMs = delayMs;
  }

  get attemptCount(): number {
    return this.attempt;
  }

  get exhausted(): boolean {
    return this.attempt >= this.options.maxAttempts;
  }

  /** Computes the next delay (ms) and increments the internal attempt counter. */
  nextDelayMs(): number {
    const base = this.serverSuggestedDelayMs ?? this.options.initialDelayMs * this.options.factor ** this.attempt;
    const capped = Math.min(base, this.options.maxDelayMs);
    this.attempt += 1;

    if (!this.options.jitter) {
      return capped;
    }

    const jitterRange = capped * 0.25;
    return Math.max(0, capped - jitterRange + Math.random() * jitterRange * 2);
  }

  /** Resets the attempt counter, e.g. after a connection stays open long enough to be considered healthy. */
  reset(): void {
    this.attempt = 0;
  }
}
