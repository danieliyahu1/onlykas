import { useEffect, useState } from "react";
import type { RequestRatesSnapshot } from "@onlykas/shared";
import { api } from "./kasware.js";

const POLL_MS = 15_000;
const WIDTH = 640;
const HEIGHT = 180;
const COLORS = ["#49eacb", "#9be8da", "#6fb8aa", "#a7b2af", "#657873"];

export function RequestRateWidget() {
  const [snapshot, setSnapshot] = useState<RequestRatesSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = await api<RequestRatesSnapshot>(
          "/api/metrics/request-rates",
        );
        if (!cancelled) setSnapshot(next);
      } catch {
        // The homepage remains usable if metrics are temporarily unavailable.
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const series = snapshot?.series ?? [];
  const maxRate = Math.max(
    0.01,
    ...series.flatMap((item) => item.rates),
  );
  const plotWidth = WIDTH - 12;
  const plotHeight = HEIGHT - 22;

  return (
    <section className="request-rate" aria-labelledby="request-rate-title">
      <header className="request-rate-header">
        <div>
          <p className="eyebrow">Live observability</p>
          <h2 id="request-rate-title">Request rate by route</h2>
        </div>
        <span className="request-rate-live">
          <i aria-hidden="true" /> live
        </span>
      </header>
      <div className="request-rate-content">
        <div className="request-rate-count">
          <strong>{snapshot?.homepageVisits.toLocaleString() ?? "--"}</strong>
          <span>homepage visits</span>
        </div>
        {series.length && snapshot ? (
          <div className="request-rate-chart">
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              role="img"
              aria-label="Request rate by route over time"
            >
              {[0.25, 0.5, 0.75].map((fraction) => (
                <line
                  key={fraction}
                  className="request-rate-grid"
                  x1="0"
                  x2={WIDTH}
                  y1={22 + plotHeight * fraction}
                  y2={22 + plotHeight * fraction}
                />
              ))}
              {series.map((item, index) => {
                const points = item.rates
                  .map((rate, pointIndex) => {
                    const x =
                      item.rates.length < 2
                        ? 0
                        : (pointIndex / (item.rates.length - 1)) * plotWidth;
                    const y = 22 + plotHeight - (rate / maxRate) * plotHeight;
                    return `${x},${y}`;
                  })
                  .join(" ");
                return (
                  <polyline
                    key={item.route}
                    className="request-rate-line"
                    points={points}
                    style={{ stroke: COLORS[index % COLORS.length] }}
                  />
                );
              })}
            </svg>
            <div className="request-rate-legend">
              {series.map((item, index) => (
                <span key={item.route}>
                  <i
                    aria-hidden="true"
                    style={{ background: COLORS[index % COLORS.length] }}
                  />
                  <b>{item.route}</b>
                  <em>
                    {(item.rates.at(-1) ?? 0).toFixed(2)} req/s
                  </em>
                </span>
              ))}
            </div>
          </div>
        ) : (
          <p className="request-rate-empty">Waiting for traffic...</p>
        )}
      </div>
    </section>
  );
}
