import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { createApp } from "./app.js";
import { FeedbackService, FeedbackSpill } from "./feedback.js";
import { createMetrics } from "./metrics.js";
import { MemoryStore } from "./memory-store.js";
import type { ObjectStorage } from "./domain.js";
import { RateLimiter } from "./rate-limit.js";

async function testFeedbackApp() {
  const dir = await mkdtemp(join(tmpdir(), "onlykas-feedback-route-"));
  const spill = new FeedbackSpill({
    filePath: join(dir, "spill.json"),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  const service = new FeedbackService({
    deliverer: { enabled: false, deliver: async () => undefined },
    spill,
    metrics: createMetrics({ version: "test", revision: "test" }),
    logger: { warn() {} },
  });
  const storage: ObjectStorage = {
    putFile: async () => undefined,
    readRange: async () => ({ bytes: new Uint8Array(), size: 0, contentType: "image/jpeg" }),
    delete: async () => undefined,
  };
  const app = createApp({
    store: new MemoryStore(),
    storage,
    walletVerifier: { verify: async () => false },
    publicOrigin: "http://localhost:5173",
    feedbackService: service,
    feedbackRateLimiter: new RateLimiter({ limit: 5, windowMs: 600_000 }),
  });
  return { app, dir, spill };
}

describe("POST /api/feedback", () => {
  it("accepts and queues feedback in the spill when Telegram is not configured", async () => {
    const { app, dir } = await testFeedbackApp();

    const response = await request(app)
      .post("/api/feedback")
      .send({ message: "The unlock button felt confusing" });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ accepted: true, queued: true });
    const raw = await readFile(join(dir, "spill.json"), "utf8");
    expect(JSON.parse(raw)).toMatchObject([
      { message: "The unlock button felt confusing" },
    ]);
    await rm(dir, { recursive: true, force: true });
  });

  it("rejects an empty message", async () => {
    const { app, dir } = await testFeedbackApp();

    const response = await request(app).post("/api/feedback").send({ message: " " });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("INVALID_FEEDBACK");
    await rm(dir, { recursive: true, force: true });
  });

  it("rejects messages over the length limit", async () => {
    const { app, dir } = await testFeedbackApp();

    const response = await request(app)
      .post("/api/feedback")
      .send({ message: "x".repeat(1501) });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("FEEDBACK_TOO_LONG");
    await rm(dir, { recursive: true, force: true });
  });

  it("enforces the per-client rate limit", async () => {
    const { app, dir } = await testFeedbackApp();

    const statuses: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      const response = await request(app)
        .post("/api/feedback")
        .send({ message: `msg ${i}` });
      statuses.push(response.status);
    }

    expect(statuses.includes(429)).toBe(true);
    expect(statuses.filter((status) => status === 202)).toHaveLength(5);
    await rm(dir, { recursive: true, force: true });
  });

  it("is unavailable when the feedback service is not wired", async () => {
    const dir = await mkdtemp(join(tmpdir(), "onlykas-feedback-missing-"));
    const storage: ObjectStorage = {
      putFile: async () => undefined,
      readRange: async () => ({ bytes: new Uint8Array(), size: 0, contentType: "image/jpeg" }),
      delete: async () => undefined,
    };
    const app = createApp({
      store: new MemoryStore(),
      storage,
      walletVerifier: { verify: async () => false },
      publicOrigin: "http://localhost:5173",
    });

    const response = await request(app)
      .post("/api/feedback")
      .send({ message: "hello" });

    expect(response.status).toBe(503);
    expect(response.body.error).toBe("FEEDBACK_UNAVAILABLE");
    await rm(dir, { recursive: true, force: true });
  });

  it("records request metrics under the feedback route template", async () => {
    const dir = await mkdtemp(join(tmpdir(), "onlykas-feedback-metrics-"));
    const spill = new FeedbackSpill({ filePath: join(dir, "spill.json") });
    const metrics = createMetrics({ version: "test", revision: "test" });
    const service = new FeedbackService({
      deliverer: { enabled: false, deliver: async () => undefined },
      spill,
      metrics,
      logger: { warn() {} },
    });
    const storage: ObjectStorage = {
      putFile: async () => undefined,
      readRange: async () => ({ bytes: new Uint8Array(), size: 0, contentType: "image/jpeg" }),
      delete: async () => undefined,
    };
    const app = createApp({
      store: new MemoryStore(),
      storage,
      walletVerifier: { verify: async () => false },
      publicOrigin: "http://localhost:5173",
      metrics,
      feedbackService: service,
    });

    await request(app).post("/api/feedback").send({ message: "metrics please" }).expect(202);

    const body = await metrics.render();
    expect(body).toContain('onlykas_feedback_total{outcome="disabled"}');
    expect(body).toContain('route="/api/feedback"');
    await rm(dir, { recursive: true, force: true });
  });
});