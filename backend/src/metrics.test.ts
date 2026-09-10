import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createMetrics, createMetricsServer } from "./metrics.js";

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

describe("metrics endpoint", () => {
  const servers: Server[] = [];
  afterEach(() => {
    for (const server of servers) server.close();
    servers.length = 0;
  });

  it("serves valid Prometheus text including recorded HTTP requests", async () => {
    const metrics = createMetrics({ version: "1.2.3", revision: "abc123" });
    metrics.httpRequestFinished({
      method: "GET",
      route: "/api/posts/:id",
      statusCode: 200,
      durationSeconds: 0.02,
    });
    const server = createMetricsServer(metrics);
    servers.push(server);
    const port = await listen(server);

    const response = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    const body = await response.text();

    expect(body).toContain("# HELP onlykas_http_requests_total");
    expect(body).toContain("# TYPE onlykas_http_requests_total counter");
    expect(body).toContain("onlykas_http_requests_total");
    expect(body).toContain('route="/api/posts/:id"');
    expect(body).toContain("onlykas_http_request_duration_seconds");
    expect(body).toContain("onlykas_build_info");
    expect(body).toContain('revision="abc123"');
    expect(body).toContain("nodejs_eventloop_lag_seconds");
  });

  it("rejects any request other than GET /metrics", async () => {
    const server = createMetricsServer(
      createMetrics({ version: "1.2.3", revision: "abc123" }),
    );
    servers.push(server);
    const port = await listen(server);

    const otherPath = await fetch(`http://127.0.0.1:${port}/other`);
    expect(otherPath.status).toBe(404);

    const otherMethod = await fetch(`http://127.0.0.1:${port}/metrics`, {
      method: "POST",
    });
    expect(otherMethod.status).toBe(404);
  });

  it("records dependency outcomes and rethrows errors", async () => {
    const metrics = createMetrics({ version: "1.2.3", revision: "abc123" });

    await expect(
      metrics.observeDependency("kaspa_rest", "utxos", async () => "ok"),
    ).resolves.toBe("ok");
    await expect(
      metrics.observeDependency("turso", "execute", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const requests = (
      await metrics.registry
        .getSingleMetric("onlykas_dependency_requests_total")!
        .get()
    ).values;
    expect(requests).toContainEqual(
      expect.objectContaining({
        labels: { dependency: "kaspa_rest", operation: "utxos", outcome: "success" },
        value: 1,
      }),
    );
    expect(requests).toContainEqual(
      expect.objectContaining({
        labels: { dependency: "turso", operation: "execute", outcome: "error" },
        value: 1,
      }),
    );

    const durations = (
      await metrics.registry
        .getSingleMetric("onlykas_dependency_request_duration_seconds")!
        .get()
    ).values;
    expect(durations.some((value) => value.labels.dependency === "turso")).toBe(
      true,
    );
  });
});
