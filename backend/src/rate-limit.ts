// Fixed-window rate limiter with a bounded key space.
//
// Keys are client addresses, so the map is capped and swept to keep a public
// endpoint from retaining unbounded per-client state.
export class RateLimiter {
  constructor(
    {
      limit,
      windowMs,
      maxKeys = 4096,
      now = Date.now,
    }: {
      limit: number;
      windowMs: number;
      maxKeys?: number;
      now?: () => number;
    } = { limit: 0, windowMs: 0 },
  ) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.now = now;
    this.windows = new Map();
  }

  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;
  private readonly windows: Map<string, { startedAt: number; count: number }>;

  check(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = this.now();
    this.sweep(now);
    let window = this.windows.get(key);
    if (!window || now - window.startedAt >= this.windowMs) {
      window = { startedAt: now, count: 0 };
      this.windows.delete(key);
      this.windows.set(key, window);
    }
    window.count += 1;
    const allowed = window.count <= this.limit;
    const retryAfterSeconds = allowed
      ? 0
      : Math.max(
          1,
          Math.ceil((window.startedAt + this.windowMs - now) / 1000),
        );
    return { allowed, retryAfterSeconds };
  }

  private sweep(now: number) {
    for (const [key, window] of this.windows) {
      if (now - window.startedAt >= this.windowMs) this.windows.delete(key);
    }
    while (this.windows.size > this.maxKeys) {
      const oldest = this.windows.keys().next().value as string | undefined;
      if (oldest === undefined) return;
      this.windows.delete(oldest);
    }
  }
}