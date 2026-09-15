import request from "supertest";
import { createApp } from "./app.js";
import { createMetrics, type Metrics } from "./metrics.js";
import { MemoryStore } from "./memory-store.js";
import type { EventLogger, Logger } from "./observability.js";
import type { ObjectStorage, PaymentGateway, Post, Store } from "./domain.js";

describe("API request diagnostics", () => {
  it("logs enough context to diagnose a missing post", async () => {
    const { app, events } = testApp();

    const response = await request(app)
      .get("/api/posts/missing-post")
      .set("X-Request-Id", "friend-trace");

    expect(response.status).toBe(404);
    expect(response.headers["x-request-id"]).toBe("friend-trace");
    expect(events).toContainEqual({
      event: "request_completed",
      fields: expect.objectContaining({
        level: "warn",
        requestId: "friend-trace",
        method: "GET",
        path: "/api/posts/missing-post",
        route: "/api/posts/:id",
        statusCode: 404,
        errorCode: "POST_NOT_FOUND",
        postId: "missing-post",
        authenticated: false,
      }),
    });
  });

  it("logs successful post requests with their correlation data", async () => {
    const store = new MemoryStore();
    await store.publishPost(post("post-123"));
    const { app, events } = testApp(store);

    const response = await request(app)
      .get("/api/posts/post-123")
      .set("X-Request-Id", "post-trace");

    expect(response.status).toBe(200);
    expect(events).toContainEqual({
      event: "request_completed",
      fields: expect.objectContaining({
        level: "info",
        requestId: "post-trace",
        statusCode: 200,
        postId: "post-123",
      }),
    });
  });

  it("correlates unexpected failures without logging request secrets", async () => {
    const store = new MemoryStore();
    store.getPost = async () => {
      throw new Error("database unavailable");
    };
    const { app, events } = testApp(store);

    const response = await request(app)
      .get("/api/posts/post-123?token=do-not-log")
      .set("X-Request-Id", "failure-trace")
      .set("Cookie", "onlykas_session=do-not-log");

    expect(response.status).toBe(503);
    expect(events).toContainEqual({
      event: "request_failed",
      fields: expect.objectContaining({
        level: "error",
        requestId: "failure-trace",
        method: "GET",
        path: "/api/posts/post-123",
        route: "/api/posts/:id",
        errorMessage: "database unavailable",
        errorStack: expect.any(String),
      }),
    });
    expect(JSON.stringify(events)).not.toContain("do-not-log");
  });

  it("does not crash when an API route does not exist", async () => {
    const { app, events } = testApp();

    const response = await request(app)
      .get("/api/does-not-exist")
      .set("X-Request-Id", "missing-route");

    expect(response.status).toBe(404);
    expect(events).toContainEqual({
      event: "request_completed",
      fields: expect.objectContaining({
        requestId: "missing-route",
        path: "/api/does-not-exist",
        statusCode: 404,
      }),
    });
    expect(events.some((entry) => "postId" in entry.fields)).toBe(false);
  });
});

describe("request metrics", () => {
  it("labels requests by route template and never by dynamic identifiers", async () => {
    const store = new MemoryStore();
    await store.publishPost(post("post-123"));
    const metrics = createMetrics({ version: "test", revision: "test" });
    const { app } = testApp(store, undefined, metrics);

    await request(app).get("/api/posts/post-123").expect(200);

    const body = await metrics.render();
    expect(body).toContain('route="/api/posts/:id"');
    expect(body).not.toContain("post-123");

    const values = (
      await metrics.registry.getSingleMetric("onlykas_http_requests_total")!.get()
    ).values;
    expect(values).toContainEqual(
      expect.objectContaining({
        labels: { method: "GET", route: "/api/posts/:id", status: "200" },
        value: 1,
      }),
    );
  });

  it("counts homepage visits without counting other routes", async () => {
    const metrics = createMetrics({ version: "test", revision: "test" });
    const { app } = testApp(undefined, undefined, metrics);

    await request(app).get("/").expect(404);
    await request(app).get("/healthz").expect(200);
    await request(app).get("/api/posts/unknown").expect(404);

    const values = (
      await metrics.registry.getSingleMetric("onlykas_page_visits_total")!.get()
    ).values;
    expect(values).toEqual([expect.objectContaining({ labels: {}, value: 1 })]);
  });
});

describe("profile visibility", () => {
  const address = `kaspatest:${"a".repeat(60)}`;
  const otherAddress = `kaspatest:${"b".repeat(60)}`;

  async function profileApp() {
    const store = new MemoryStore();
    await store.createSession({
      id: "profile-session",
      address,
      expiresAt: Date.now() + 60_000,
    });
    return { store, app: testApp(store).app };
  }

  it("defaults profiles to private and allows visibility-only updates", async () => {
    const { app, store } = await profileApp();

    const initial = await request(app)
      .get("/api/profile")
      .set("Cookie", "onlykas_session=profile-session");
    expect(initial.body).toMatchObject({ address, displayName: null, isPublic: false });

    const updated = await request(app)
      .put("/api/profile")
      .set("Cookie", "onlykas_session=profile-session")
      .send({ isPublic: true });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ address, isPublic: true });
    expect((await store.getProfile(address))?.isPublic).toBe(true);
  });

  it("returns only public profiles from the public creators endpoint", async () => {
    const { app, store } = await profileApp();
    await store.saveProfile({
      address,
      displayName: "Visible",
      isPublic: true,
      updatedAt: Date.now(),
    });
    await store.saveProfile({
      address: otherAddress,
      displayName: "Hidden",
      isPublic: false,
      updatedAt: Date.now(),
    });

    const response = await request(app).get("/api/creators/public");
    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({ address, displayName: "Visible" }),
    ]);
  });

  it("keeps the display name when only visibility is toggled", async () => {
    const { app, store } = await profileApp();

    const named = await request(app)
      .put("/api/profile")
      .set("Cookie", "onlykas_session=profile-session")
      .send({ displayName: "Maya" });
    expect(named.body).toMatchObject({ address, displayName: "Maya", isPublic: false });

    const toggled = await request(app)
      .put("/api/profile")
      .set("Cookie", "onlykas_session=profile-session")
      .send({ isPublic: true });
    expect(toggled.body).toMatchObject({ displayName: "Maya", isPublic: true });
    expect(await store.getProfile(address)).toMatchObject({
      displayName: "Maya",
      isPublic: true,
    });
  });

  it("keeps the visibility state when the display name changes", async () => {
    const { app, store } = await profileApp();

    const madePublic = await request(app)
      .put("/api/profile")
      .set("Cookie", "onlykas_session=profile-session")
      .send({ isPublic: true });
    expect(madePublic.body).toMatchObject({ isPublic: true, displayName: null });

    const renamed = await request(app)
      .put("/api/profile")
      .set("Cookie", "onlykas_session=profile-session")
      .send({ displayName: "Maya" });
    expect(renamed.body).toMatchObject({ displayName: "Maya", isPublic: true });
    expect(await store.getProfile(address)).toMatchObject({
      displayName: "Maya",
      isPublic: true,
    });
  });

  it("still serves private profiles by direct address", async () => {
    const { app, store } = await profileApp();
    await store.saveProfile({
      address,
      displayName: "Hidden",
      isPublic: false,
      updatedAt: Date.now(),
    });

    const direct = await request(app).get(`/api/creators/${address}`);
    expect(direct.status).toBe(200);
    expect(direct.body).toMatchObject({
      address,
      displayName: "Hidden",
      isPublic: false,
    });

    const directory = await request(app).get("/api/creators/public");
    expect(directory.body).toEqual([]);
  });
});

describe("payment confirmation", () => {
  async function buyerSession(store: MemoryStore) {
    const buyer = `kaspatest:${"b".repeat(60)}`;
    await store.createSession({
      id: "session-1",
      address: buyer,
      expiresAt: Date.now() + 60_000,
    });
    return buyer;
  }

  it("confirms the purchase once the node accepts the transaction", async () => {
    const store = new MemoryStore();
    const buyer = await buyerSession(store);
    const target = post("paid-post");
    await store.publishPost(target);
    const gateway: PaymentGateway = {
      prepare: async () => ({
        transaction: "{}",
        fingerprint: "fp",
        amountSompi: target.priceSompi,
        creator: target.creator,
      }),
      submit: async () => ({
        isAccepted: true,
        transactionId: "tx-1",
        rejection: null,
      }),
      status: async () => ({
        isAccepted: true,
        transactionId: "tx-1",
        rejection: null,
      }),
      verifyPurchase: async () => true,
    };
    const { app } = testApp(store, gateway);
    const cookie = "onlykas_session=session-1";

    const prepared = await request(app)
      .post("/api/posts/paid-post/payments/prepare")
      .set("Cookie", cookie);
    expect(prepared.status).toBe(201);

    const finalized = await request(app)
      .post(`/api/payments/${prepared.body.id}/finalize`)
      .set("Cookie", cookie)
      .send({ signedTransaction: "{}" });
    expect(finalized.status).toBe(201);
    expect(finalized.body.state).toBe("CONFIRMED");
    expect(await store.getPurchase("paid-post", buyer)).not.toBeNull();
  });

  it("reports pending when the node has not indexed the transaction yet", async () => {
    const store = new MemoryStore();
    const buyer = await buyerSession(store);
    const target = post("paid-post");
    await store.publishPost(target);
    const gateway: PaymentGateway = {
      prepare: async () => ({
        transaction: "{}",
        fingerprint: "fp",
        amountSompi: target.priceSompi,
        creator: target.creator,
      }),
      submit: async () => ({
        isAccepted: null,
        transactionId: "tx-1",
        rejection: null,
      }),
      status: async () => ({
        isAccepted: null,
        transactionId: "tx-1",
        rejection: null,
      }),
      verifyPurchase: async () => true,
    };
    const { app } = testApp(store, gateway);
    const cookie = "onlykas_session=session-1";

    const prepared = await request(app)
      .post("/api/posts/paid-post/payments/prepare")
      .set("Cookie", cookie);
    const finalized = await request(app)
      .post(`/api/payments/${prepared.body.id}/finalize`)
      .set("Cookie", cookie)
      .send({ signedTransaction: "{}" });
    expect(finalized.status).toBe(202);
    expect(finalized.body.state).toBe("PENDING");
    expect(finalized.body.transactionId).toBe("tx-1");
    expect(await store.getPurchase("paid-post", buyer)).toBeNull();
    expect(await store.getPreparedPayment(prepared.body.id, Date.now())).toBeNull();
  });
});

function testApp(
  store: Store = new MemoryStore(),
  paymentGateway?: PaymentGateway,
  metrics?: Metrics,
) {
  const events: Array<{ event: string; fields: Record<string, unknown> }> = [];
  const record =
    (level: string): EventLogger =>
    (event, fields = {}) => {
      events.push({ event, fields: { level, ...fields } });
    };
  const logger: Logger = {
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
  };
  const storage: ObjectStorage = {
    putFile: async () => undefined,
    readRange: async () => ({
      bytes: new Uint8Array(),
      size: 0,
      contentType: "image/jpeg",
    }),
    delete: async () => undefined,
  };
  const app = createApp({
    store,
    storage,
    walletVerifier: { verify: async () => false },
    ...(paymentGateway ? { paymentGateway } : {}),
    publicOrigin: "http://localhost:5173",
    logger,
    ...(metrics ? { metrics } : {}),
  });
  return { app, events };
}

function post(id: string): Post {
  return {
    id,
    creator: "kaspatest:qqtestcreator",
    caption: "A private post",
    priceSompi: "100000000",
    mediaType: "image/jpeg",
    mediaSize: 10,
    mediaDigest: `${id}-digest`,
    mediaKey: `media/${id}`,
    publishedAt: Date.now(),
  };
}
