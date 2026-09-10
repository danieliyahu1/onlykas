import request from "supertest";
import { createApp } from "./app.js";
import { MemoryStore } from "./memory-store.js";
import type { EventLogger } from "./observability.js";
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
});

describe("payment confirmation", () => {
  async function buyerSession(store: MemoryStore) {
    const buyer = `kaspatest:${"b".repeat(60)}`;
    await store.createSession({ id: "session-1", address: buyer, expiresAt: Date.now() + 60_000 });
    return buyer;
  }

  it("confirms the purchase once the node accepts the transaction", async () => {
    const store = new MemoryStore();
    const buyer = await buyerSession(store);
    const target = post("paid-post");
    await store.publishPost(target);
    const gateway: PaymentGateway = {
      prepare: async () => ({ transaction: "{}", fingerprint: "fp", amountSompi: target.priceSompi, creator: target.creator }),
      submit: async () => ({ isAccepted: true, transactionId: "tx-1", rejection: null }),
      status: async () => ({ isAccepted: true, transactionId: "tx-1", rejection: null }),
      verifyPurchase: async () => true,
    };
    const { app } = testApp(store, gateway);
    const cookie = "onlykas_session=session-1";

    const prepared = await request(app).post("/api/posts/paid-post/payments/prepare").set("Cookie", cookie);
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
    await buyerSession(store);
    const target = post("paid-post");
    await store.publishPost(target);
    const gateway: PaymentGateway = {
      prepare: async () => ({ transaction: "{}", fingerprint: "fp", amountSompi: target.priceSompi, creator: target.creator }),
      submit: async () => ({ isAccepted: null, transactionId: "tx-1", rejection: null }),
      status: async () => ({ isAccepted: null, transactionId: "tx-1", rejection: null }),
      verifyPurchase: async () => true,
    };
    const { app } = testApp(store, gateway);
    const cookie = "onlykas_session=session-1";

    const prepared = await request(app).post("/api/posts/paid-post/payments/prepare").set("Cookie", cookie);
    const finalized = await request(app)
      .post(`/api/payments/${prepared.body.id}/finalize`)
      .set("Cookie", cookie)
      .send({ signedTransaction: "{}" });
    expect(finalized.status).toBe(202);
    expect(finalized.body.state).toBe("PENDING");
  });
});

function testApp(store: Store = new MemoryStore(), paymentGateway?: PaymentGateway) {
  const events: Array<{ event: string; fields: Record<string, unknown> }> = [];
  const logger: EventLogger = (event, fields = {}) => {
    events.push({ event, fields });
  };
  const storage: ObjectStorage = {
    putFile: async () => undefined,
    readRange: async () => ({ bytes: new Uint8Array(), size: 0, contentType: "image/jpeg" }),
    delete: async () => undefined,
  };
  const app = createApp({
    store,
    storage,
    walletVerifier: { verify: async () => false },
    ...(paymentGateway ? { paymentGateway } : {}),
    publicOrigin: "http://localhost:5173",
    logger,
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
