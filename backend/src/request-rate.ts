import type {
  RequestRatesSnapshot,
  RequestRateSeries,
} from "@onlykas/shared";
import type { Metrics } from "./metrics.js";

const POLL_INTERVAL_MS = 15_000;
const WINDOW_SAMPLES = 40;
const MAX_SERIES = 6;

interface Sample {
  /** Epoch milliseconds when the sample was taken. */
  at: number;
  /** Per-route cumulative request counts as of the sample. */
  totals: Map<string, number>;
}

/**
 * Samples the per-route HTTP request counters on an interval and derives a
 * rolling rate (requests/second) per route. Prometheus counters are cumulative
 * only, so rates are computed from deltas between consecutive samples. The
 * sampler backs a public JSON endpoint consumed by the homepage widget.
 */
export class RequestRateSampler {
  private samples: Sample[] = [];
  private readonly startedAt = Date.now();
  private timer: ReturnType<typeof setInterval> | null = null;
  private totalRequestsAtLastSample = 0;

  constructor(
    private readonly metrics: Metrics,
    private readonly intervalMs = POLL_INTERVAL_MS,
    private readonly windowSize = WINDOW_SAMPLES,
  ) {}

  start(): void {
    this.sample();
    this.timer = setInterval(() => this.sample(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  snapshot(maxSeries = MAX_SERIES): RequestRatesSnapshot {
    const totalsAt = new Map<string, number>();
    for (const sample of this.samples) {
      for (const [route, total] of sample.totals) {
        totalsAt.set(route, Math.max(total, totalsAt.get(route) ?? 0));
      }
    }

    // Rank routes by total volume, most active first, and cap the count so the
    // widget stays readable and series identifiers stay bounded.
    const routes = [...totalsAt.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxSeries)
      .map(([route]) => route);

    const timestamps = this.samples.map((sample) => sample.at);

    const series: RequestRateSeries[] = routes.map((route) => {
      const rates: number[] = this.samples.map((sample, index) => {
        if (index === 0) return 0;
        const previous = this.samples[index - 1]!;
        const delta =
          (sample.totals.get(route) ?? 0) -
          (previous.totals.get(route) ?? 0);
        const seconds = Math.max(1, (sample.at - previous.at) / 1000);
        return delta / seconds;
      });
      return { route, rates };
    });

    return {
      total: this.metrics.totalRequestsCompleted(),
      homepageVisits: this.metrics.homepageVisitsCompleted(),
      startedAt: this.startedAt,
      intervalMs: this.intervalMs,
      timestamps,
      series,
    };
  }

  private sample(): void {
    this.samples.push({
      at: Date.now(),
      totals: new Map(this.metrics.requestRouteTotals()),
    });
    if (this.samples.length > this.windowSize) this.samples.shift();
  }
}
