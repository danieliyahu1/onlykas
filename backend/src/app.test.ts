import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { PUBLIC_PAGES } from "@kaskama/shared";
import { createApp } from "./app.js";
import { createMetrics, type Metrics } from "./metrics.js";
import { MemoryStore } from "./memory-store.js";
import type { EventLogger, Logger } from "./observability.js";
import type { MembershipCheck, Post } from "./domain/models.js";
import { StorageError } from "./r2-storage.js";
import { TestStorage } from "./test-storage.js";
import type { VerifiedMedia } from "./adapters/media/media.js";
import {
  MembershipStateChangedError,
  type MembershipGateway,
  type MembershipVerifier,
  type ObjectStorage,
  type PaymentGateway,
  type Repositories,
} from "./application/ports.js";

describe("API request diagnostics", () => {
  it("logs enough context to diagnose a missing post", async () => {
    const { app, events } = testApp();

    const response = await request(app)
      .get("/api/posts/missing-post")
      .set("X-Request-Id", "friend-trace");

    expect(response.status).toBe(404);
    expect(response.headers["x-request-id"]).toBe("friend-trace");
    expect(response.body.requestId).toBe("friend-trace");
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
      .set("Cookie", "kaskama_session=do-not-log");

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

  it("names the failing field when a request body is invalid", async () => {
    const { app, events } = testApp();

    const response = await request(app)
      .post("/api/auth/challenge")
      .set("X-Request-Id", "validation-trace")
      .send({});

    expect(response.status).toBe(400);
    expect(events).toContainEqual({
      event: "validation_failed",
      fields: expect.objectContaining({
        level: "warn",
        requestId: "validation-trace",
        route: "/api/auth/challenge",
        fields: ["address"],
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "address" }),
        ]),
      }),
    });
    expect(events).toContainEqual({
      event: "request_completed",
      fields: expect.objectContaining({
        requestId: "validation-trace",
        statusCode: 400,
        errorCode: "INVALID_REQUEST",
        errorFields: ["address"],
      }),
    });
  });

  it("explains a wrong-network wallet address without logging it", async () => {
    const address =
      "kaspa:qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
    const { app, events } = testApp();

    const response = await request(app)
      .post("/api/auth/challenge")
      .set("X-Request-Id", "prefix-trace")
      .send({ address });

    expect(response.status).toBe(400);
    expect(events).toContainEqual({
      event: "challenge_rejected",
      fields: expect.objectContaining({
        level: "warn",
        requestId: "prefix-trace",
        problem: "wrong_prefix",
        prefix: "kaspa",
        expectedPrefix: "kaspatest",
      }),
    });
    expect(JSON.stringify(events)).not.toContain(address);
  });

  it("resolves a rejected challenge request by its correlation id", async () => {
    const { app, events } = testApp();

    const response = await request(app)
      .post("/api/auth/challenge")
      .set("X-Request-Id", "resolve-trace")
      .send({ address: "not-an-address" });

    expect(response.status).toBe(400);
    expect(response.body.requestId).toBe("resolve-trace");
    const trace = events.filter(
      (entry) => entry.fields.requestId === "resolve-trace",
    );
    expect(trace.map((entry) => entry.event)).toEqual(
      expect.arrayContaining(["validation_failed", "challenge_rejected", "request_completed"]),
    );
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
      await metrics.registry.getSingleMetric("kaskama_http_requests_total")!.get()
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
      await metrics.registry.getSingleMetric("kaskama_page_visits_total")!.get()
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

  it("defaults profiles to public and allows visibility-only updates", async () => {
    const { app, store } = await profileApp();

    const initial = await request(app)
      .get("/api/profile")
      .set("Cookie", "kaskama_session=profile-session");
    expect(initial.body).toMatchObject({ address, displayName: null, isPublic: true });

    const updated = await request(app)
      .put("/api/profile")
      .set("Cookie", "kaskama_session=profile-session")
      .send({ isPublic: false });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ address, isPublic: false });
    expect((await store.getProfile(address))?.isPublic).toBe(false);
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
    await store.publishPost({ ...post("visible-post"), creator: address });

    const response = await request(app).get("/api/creators/public");
    expect(response.status).toBe(200);
    expect(response.body).toEqual([
      expect.objectContaining({ address, displayName: "Visible" }),
    ]);
  });

  it("excludes public profiles that have no posts", async () => {
    const { app, store } = await profileApp();
    await store.saveProfile({
      address,
      displayName: "Empty Creator",
      isPublic: true,
      updatedAt: Date.now(),
    });

    const response = await request(app).get("/api/creators/public");
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it("keeps the display name when only visibility is toggled", async () => {
    const { app, store } = await profileApp();

    const named = await request(app)
      .put("/api/profile")
      .set("Cookie", "kaskama_session=profile-session")
      .send({ displayName: "Maya" });
    expect(named.body).toMatchObject({ address, displayName: "Maya", isPublic: true });

    const toggled = await request(app)
      .put("/api/profile")
      .set("Cookie", "kaskama_session=profile-session")
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
      .set("Cookie", "kaskama_session=profile-session")
      .send({ isPublic: true });
    expect(madePublic.body).toMatchObject({ isPublic: true, displayName: null });

    const renamed = await request(app)
      .put("/api/profile")
      .set("Cookie", "kaskama_session=profile-session")
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
    const cookie = "kaskama_session=session-1";

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
    let indexed = false;
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
        isAccepted: indexed ? true : null,
        transactionId: "tx-1",
        rejection: null,
      }),
      verifyPurchase: async () => true,
    };
    const { app } = testApp(store, gateway);
    const cookie = "kaskama_session=session-1";

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
    expect(await store.getPreparedPayment(prepared.body.id, Date.now())).not.toBeNull();
    expect(await store.getPaymentWorkflow(prepared.body.id)).toMatchObject({
      state: "SUBMITTED",
      transactionId: "tx-1",
    });

    indexed = true;
    const retried = await request(app)
      .post(`/api/payments/${prepared.body.id}/finalize`)
      .set("Cookie", cookie)
      .send({});
    expect(retried.status).toBe(201);
    expect(await store.getPurchase("paid-post", buyer)).not.toBeNull();
  });
});

describe("free posts", () => {
  const freePost = (id: string): Post => ({ ...post(id), priceSompi: "0" });
  const viewer = `kaspatest:${"b".repeat(60)}`;

  async function viewerSession(store: MemoryStore) {
    await store.createSession({
      id: "session-viewer",
      address: viewer,
      expiresAt: Date.now() + 60_000,
    });
    return "kaskama_session=session-viewer";
  }

  it("serves free post metadata to everyone with canView true", async () => {
    const store = new MemoryStore();
    await store.publishPost(freePost("free-post"));
    const { app } = testApp(store);

    const response = await request(app).get("/api/posts/free-post");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: "free-post",
      priceSompi: "0",
      canView: true,
    });
  });

  it("lets any signed-in viewer fetch free post media", async () => {
    const store = new MemoryStore();
    await store.publishPost(freePost("free-post"));
    const cookie = await viewerSession(store);
    const { app } = testApp(store);

    const response = await request(app)
      .get("/api/posts/free-post/media")
      .set("Cookie", cookie);
    expect(response.status).toBe(200);
  });

  it("blocks payment preparation for free posts", async () => {
    const store = new MemoryStore();
    await store.publishPost(freePost("free-post"));
    const cookie = await viewerSession(store);
    const gateway: PaymentGateway = {
      prepare: async () => {
        throw new Error("prepare must not run for free posts");
      },
      submit: async () => ({ isAccepted: false, transactionId: null, rejection: null }),
      status: async () => ({ isAccepted: false, transactionId: null, rejection: null }),
      verifyPurchase: async () => false,
    };
    const { app } = testApp(store, gateway);

    const response = await request(app)
      .post("/api/posts/free-post/payments/prepare")
      .set("Cookie", cookie);
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("ALREADY_UNLOCKED");
  });

  it("marks free posts unlocked and paid posts locked in the creator listing", async () => {
    const store = new MemoryStore();
    const creator = `kaspatest:${"c".repeat(50)}`;
    await store.publishPost({ ...freePost("free-post"), creator });
    await store.publishPost({ ...post("paid-post"), creator });
    const { app } = testApp(store);

    const response = await request(app).get(`/api/creators/${creator}`);
    expect(response.status).toBe(200);
    const byId = Object.fromEntries(
      response.body.posts.map((p: { id: string; canView: boolean }) => [p.id, p]),
    );
    expect(byId["free-post"].canView).toBe(true);
    expect(byId["paid-post"].canView).toBe(false);
  });
});

describe("subscription recognition", () => {
  const creator = `kaspatest:${"c".repeat(60)}`;
  const viewer = `kaspatest:${"b".repeat(60)}`;

  async function viewerSession(store: MemoryStore) {
    await store.createSession({
      id: "member-session",
      address: viewer,
      expiresAt: Date.now() + 60_000,
    });
    return "kaskama_session=member-session";
  }

  function membershipCheck(status: MembershipCheck["status"]): MembershipCheck {
    return {
      transactionId: "tx-1",
      outputIndex: 1,
      covenantId: "covenant-1",
      kind: "token",
      tokenType: "membership",
      owner: viewer,
      contentCreator: creator,
      platformAddress: creator,
      createdAtDaa: "1",
      expiresAtDaa: "2",
      createdAt: null,
      validUntil: null,
      status,
    };
  }

  it("recognizes a subscriber found on chain without a stored receipt", async () => {
    const store = new MemoryStore();
    await store.publishPost({ ...post("paid-post"), creator });
    await store.saveCreatorCovenant({
      creator,
      covenantId: "covenant-1",
      priceSompi: "1000000000",
    });
    const cookie = await viewerSession(store);
    const findMembership = vi.fn(async () => membershipCheck("VALID"));
    const verifier: MembershipVerifier = {
      verifyAddress: async () => [],
      findMembership,
      verifyUtxo: async () => membershipCheck("NOT_MEMBERSHIP"),
    };
    const { app } = testApp(
      store,
      undefined,
      undefined,
      undefined,
      undefined,
      verifier,
    );

    const creatorResponse = await request(app)
      .get(`/api/creators/${creator}`)
      .set("Cookie", cookie);
    expect(creatorResponse.body.membership).toEqual({
      offered: true,
      active: true,
      priceSompi: "1000000000",
      durationDays: 30,
    });
    expect(creatorResponse.body.posts[0].canView).toBe(true);
    expect(findMembership).toHaveBeenCalledWith(viewer, creator, "covenant-1");
    expect(await store.membershipReceipts(viewer, creator)).toHaveLength(1);

    const postResponse = await request(app)
      .get("/api/posts/paid-post")
      .set("Cookie", cookie);
    expect(postResponse.body.canView).toBe(true);
  });

  it("keeps a viewer locked when no membership is found on chain", async () => {
    const store = new MemoryStore();
    await store.publishPost({ ...post("paid-post"), creator });
    await store.saveCreatorCovenant({
      creator,
      covenantId: "covenant-1",
      priceSompi: "1000000000",
    });
    const cookie = await viewerSession(store);
    const verifier: MembershipVerifier = {
      verifyAddress: async () => [],
      findMembership: async () => null,
      verifyUtxo: async () => membershipCheck("NOT_MEMBERSHIP"),
    };
    const { app } = testApp(
      store,
      undefined,
      undefined,
      undefined,
      undefined,
      verifier,
    );

    const response = await request(app)
      .get(`/api/creators/${creator}`)
      .set("Cookie", cookie);
    expect(response.body.membership.active).toBe(false);
    expect(response.body.posts[0].canView).toBe(false);
  });
});

describe("anonymous media access", () => {
  it("serves free post media without a session", async () => {
    const store = new MemoryStore();
    await store.publishPost({ ...post("free-post"), priceSompi: "0" });
    const { app } = testApp(store);

    const response = await request(app).get("/api/posts/free-post/media");
    expect(response.status).toBe(200);
  });
  it("requires a session for paid post media", async () => {
    const store = new MemoryStore();
    await store.publishPost(post("paid-post"));
    const { app } = testApp(store);

    const response = await request(app).get("/api/posts/paid-post/media");

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("AUTHENTICATION_REQUIRED");
  });
});

describe("media stream diagnostics", () => {
  it("logs and fails a stalled media read with its byte counts", async () => {
    const store = new MemoryStore();
    await store.publishPost({
      ...post("stalled-post"),
      priceSompi: "0",
      mediaType: "video/mp4",
      mediaSize: 3_070_591,
      mediaKey: "media/stalled",
    });
    const storage: ObjectStorage = {
      putFile: async () => undefined,
      readRange: async () => ({
        bytes: new Uint8Array(),
        size: 0,
        contentType: "video/mp4",
      }),
      streamRange: async () => ({
        body: {
          [Symbol.asyncIterator]: () => ({
            next: () =>
              Promise.reject(
                new StorageError(
                  "get_object",
                  "media/stalled",
                  "STORAGE_TIMEOUT",
                  undefined,
                  "TimeoutError",
                  "r2-timeout-1",
                  undefined,
                  new Error("socket timed out"),
                ),
              ),
          }),
        },
        size: 3_070_591,
        contentType: "video/mp4",
      }),
      delete: async () => undefined,
    };
    const { app, events } = testApp(store, undefined, undefined, storage);

    const response = await request(app).get("/api/posts/stalled-post/media");

    expect(response.status).toBe(504);
    expect(response.body.error).toBe("MEDIA_STREAM_FAILED");
    expect(events).toContainEqual({
      event: "media_stream_failed",
      fields: expect.objectContaining({
        level: "warn",
        postId: "stalled-post",
        mediaKey: "media/stalled",
        mediaType: "video/mp4",
        expectedBytes: 3_070_591,
        deliveredBytes: 0,
        headersSent: false,
        storageOperation: "get_object",
        storageCategory: "STORAGE_TIMEOUT",
        storageRequestId: "r2-timeout-1",
      }),
    });
  });

  it("maps a storage timeout before streaming to 504 with its correlation id", async () => {
    const store = new MemoryStore();
    await store.publishPost({ ...post("timeout-post"), priceSompi: "0" });
    const storage: ObjectStorage = {
      putFile: async () => undefined,
      readRange: async () => ({
        bytes: new Uint8Array(),
        size: 0,
        contentType: "image/jpeg",
      }),
      streamRange: async () => {
        throw new StorageError(
          "head_object",
          "media/timeout-post",
          "STORAGE_TIMEOUT",
          undefined,
          "TimeoutError",
          "r2-timeout-2",
          undefined,
          new Error("connection timed out"),
        );
      },
      delete: async () => undefined,
    };
    const { app, events } = testApp(store, undefined, undefined, storage);

    const response = await request(app)
      .get("/api/posts/timeout-post/media")
      .set("X-Request-Id", "timeout-trace");

    expect(response.status).toBe(504);
    expect(response.body).toMatchObject({
      error: "MEDIA_STORAGE_TIMEOUT",
      requestId: "timeout-trace",
    });
    expect(events).toContainEqual({
      event: "request_failed",
      fields: expect.objectContaining({
        level: "error",
        requestId: "timeout-trace",
        errorCode: "MEDIA_STORAGE_TIMEOUT",
        storageCategory: "STORAGE_TIMEOUT",
      }),
    });
  });

  it("records a stalled request and the abort that follows it", async () => {
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
    const store = new MemoryStore();
    await store.publishPost({
      ...post("hang-post"),
      priceSompi: "0",
      mediaKey: "media/hang",
    });
    const storage: ObjectStorage = {
      putFile: async () => undefined,
      readRange: async () => ({
        bytes: new Uint8Array(),
        size: 0,
        contentType: "video/mp4",
      }),
      streamRange: async () => ({
        body: (async function* () {
          await new Promise(() => undefined);
          yield new Uint8Array();
        })(),
        size: 10,
        contentType: "video/mp4",
      }),
      delete: async () => undefined,
    };
    const app = createApp({
      store,
      storage,
      walletVerifier: { verify: async () => false },
      publicOrigin: "http://localhost:5173",
      logger,
      responseStallMs: 20,
    });

    await request(app)
      .get("/api/posts/hang-post/media")
      .timeout({ response: 150 })
      .catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(events).toContainEqual({
      event: "request_stalled",
      fields: expect.objectContaining({
        level: "warn",
        path: "/api/posts/hang-post/media",
        route: "/api/posts/:id/media",
      }),
    });
    expect(events).toContainEqual({
      event: "request_aborted",
      fields: expect.objectContaining({
        level: "warn",
        path: "/api/posts/hang-post/media",
      }),
    });
  });
});

describe("locked media previews", () => {
  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );

  it("serves a blurred preview for a locked post without exposing its media", async () => {
    const store = new MemoryStore();
    await store.publishPost(post("preview-post"));
    const storage = new TestStorage();
    storage.objects.set("media/preview-post", {
      bytes: new Uint8Array(onePixelPng),
      contentType: "image/jpeg",
    });
    const { app } = testApp(store, undefined, undefined, storage);

    const media = await request(app).get("/api/posts/preview-post/media");
    expect(media.status).toBe(401);

    const preview = await request(app).get("/api/posts/preview-post/preview");
    expect(preview.status).toBe(200);
    expect(preview.headers["content-type"]).toContain("image/jpeg");
    expect(storage.objects.has("previews/v8/preview-post.jpg")).toBe(true);
  });

  it("keeps a served preview out of the way when the post is missing", async () => {
    const { app } = testApp();

    const response = await request(app).get("/api/posts/missing-post/preview");

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("POST_NOT_FOUND");
  });
});

describe("post deletion", () => {
  const creator = `kaspatest:${"c".repeat(60)}`;
  const other = `kaspatest:${"o".repeat(60)}`;

  async function session(store: MemoryStore, address: string) {
    await store.createSession({
      id: "delete-session",
      address,
      expiresAt: Date.now() + 60_000,
    });
    return "kaskama_session=delete-session";
  }

  it("requires a session", async () => {
    const store = new MemoryStore();
    await store.publishPost({ ...post("paid-post"), creator });
    const { app } = testApp(store);

    const response = await request(app).delete("/api/posts/paid-post");

    expect(response.status).toBe(401);
    expect(await store.getPost("paid-post")).not.toBeNull();
  });

  it("refuses a viewer who is not the creator", async () => {
    const store = new MemoryStore();
    await store.publishPost({ ...post("paid-post"), creator });
    const cookie = await session(store, other);
    const { app } = testApp(store);

    const response = await request(app)
      .delete("/api/posts/paid-post")
      .set("Cookie", cookie);

    expect(response.status).toBe(403);
    expect(await store.getPost("paid-post")).not.toBeNull();
  });

  it("deletes the creator's post, its media, and its purchases", async () => {
    const store = new MemoryStore();
    await store.publishPost({
      ...post("paid-post"),
      creator,
      mediaKey: "media/creator/ab/digest",
    });
    await store.createPurchase({
      postId: "paid-post",
      buyer: other,
      transactionId: "tx-1",
    });
    const cookie = await session(store, creator);
    const removedMedia: string[] = [];
    const storage: ObjectStorage = {
      putFile: async () => undefined,
      readRange: async () => ({
        bytes: new Uint8Array(),
        size: 0,
        contentType: "image/jpeg",
      }),
      delete: async (key) => void removedMedia.push(key),
    };
    const { app } = testApp(store, undefined, undefined, storage);

    const response = await request(app)
      .delete("/api/posts/paid-post")
      .set("Cookie", cookie);

    expect(response.status).toBe(204);
    expect(await store.getPost("paid-post")).toBeNull();
    expect(await store.getPurchase("paid-post", other)).toBeNull();
    expect(removedMedia).toEqual([
      "media/creator/ab/digest",
      "previews/v8/creator/ab/digest.jpg",
    ]);
  });
});

describe("publish failure diagnostics", () => {
  const creator = `kaspatest:${"c".repeat(60)}`;

  const verifiedVideo: VerifiedMedia = {
    digest: "d".repeat(64),
    mediaType: "video/mp4",
    size: 64,
  };

  async function creatorApp(
    storage: ObjectStorage,
    verifyMedia: (path: string) => Promise<VerifiedMedia>,
  ) {
    const store = new MemoryStore();
    await store.createSession({
      id: "publish-session",
      address: creator,
      expiresAt: Date.now() + 60_000,
    });
    return testApp(store, undefined, undefined, storage, verifyMedia);
  }

  it("reports a storage failure with its own code and keeps the correlation id", async () => {
    const storage: ObjectStorage = {
      putFile: async () => {
        throw new StorageError(
          "put_object",
          "media/blake3/ab/abc",
          "STORAGE_FORBIDDEN",
          403,
          "AccessDenied",
          "r2-request-1",
          undefined,
          new Error("access denied"),
        );
      },
      readRange: async () => ({
        bytes: new Uint8Array(),
        size: 0,
        contentType: "video/mp4",
      }),
      delete: async () => undefined,
    };
    const { app, events } = await creatorApp(storage, async () => verifiedVideo);

    const response = await request(app)
      .post("/api/posts/publish")
      .set("X-Request-Id", "publish-trace")
      .set("Cookie", "kaskama_session=publish-session")
      .field("caption", "A private post")
      .field("price", "1")
      .attach("media", Buffer.alloc(64), {
        filename: "clip.mp4",
        contentType: "video/mp4",
      });

    expect(response.status).toBe(502);
    expect(response.headers["x-request-id"]).toBe("publish-trace");
    expect(response.body).toMatchObject({
      error: "MEDIA_STORAGE_FAILED",
      requestId: "publish-trace",
    });

    expect(events).toContainEqual({
      event: "request_failed",
      fields: expect.objectContaining({
        level: "error",
        requestId: "publish-trace",
        path: "/api/posts/publish",
        errorCode: "MEDIA_STORAGE_FAILED",
        storageOperation: "put_object",
        storageServiceCode: "AccessDenied",
        storageRequestId: "r2-request-1",
      }),
    });
    expect(events).toContainEqual({
      event: "request_completed",
      fields: expect.objectContaining({
        requestId: "publish-trace",
        statusCode: 502,
        errorCode: "MEDIA_STORAGE_FAILED",
      }),
    });
  });

  it("stores a multi-line, non-ASCII caption carried in the upload body", async () => {
    const store = new MemoryStore();
    await store.createSession({
      id: "publish-session",
      address: creator,
      expiresAt: Date.now() + 60_000,
    });
    const caption = "First line\nSecond line 🎉 — naïve";
    const { app } = testApp(
      store,
      undefined,
      undefined,
      undefined,
      async () => verifiedVideo,
    );

    const response = await request(app)
      .post("/api/posts/publish")
      .set("Cookie", "kaskama_session=publish-session")
      .field("caption", caption)
      .field("price", "1")
      .attach("media", Buffer.alloc(64), {
        filename: "clip.mp4",
        contentType: "video/mp4",
      });

    expect(response.status).toBe(201);
    expect(response.body.id).toEqual(expect.any(String));
    const [created] = await store.creatorPosts(creator);
    expect(created?.caption).toBe(caption);
  });

  it("rejects an upload with no media file", async () => {
    const { app } = await creatorApp(
      {
        putFile: async () => undefined,
        readRange: async () => ({
          bytes: new Uint8Array(),
          size: 0,
          contentType: "video/mp4",
        }),
        delete: async () => undefined,
      },
      async () => verifiedVideo,
    );

    const response = await request(app)
      .post("/api/posts/publish")
      .set("Cookie", "kaskama_session=publish-session")
      .field("caption", "A private post")
      .field("price", "1");

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: "INVALID_MEDIA" });
  });
});

describe("membership price validation", () => {
  async function creatorSession(store: MemoryStore) {
    const creator = `kaspatest:${"c".repeat(60)}`;
    await store.createSession({
      id: "creator-session",
      address: creator,
      expiresAt: Date.now() + 60_000,
    });
    return creator;
  }

  it.each(["/api/membership/offers/prepare", "/api/membership/price/prepare"])(
    "rejects an invalid price on %s before touching the chain",
    async (path) => {
      const store = new MemoryStore();
      await creatorSession(store);
      const { app } = testApp(
        store,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {} as MembershipGateway,
      );

      const response = await request(app)
        .post(path)
        .set("Cookie", "kaskama_session=creator-session")
        .send({ price: "1,000" });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        error: "INVALID_MEMBERSHIP_PRICE",
        message: "Enter the price in digits only, with up to 8 decimal places.",
      });
    },
  );

  it.each([
    ["", "Enter a monthly subscription price."],
    ["1,000", "Enter the price in digits only, with up to 8 decimal places."],
    ["0.5", "The monthly subscription price must be at least 1 KAS."],
    ["1000001", "The monthly subscription price can be at most 1,000,000 KAS."],
  ])("explains why %s is rejected", async (price, message) => {
    const store = new MemoryStore();
    await creatorSession(store);
    const { app } = testApp(
      store,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {} as MembershipGateway,
    );

    const response = await request(app)
      .post("/api/membership/price/prepare")
      .set("Cookie", "kaskama_session=creator-session")
      .send({ price });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: "INVALID_MEMBERSHIP_PRICE",
      message,
    });
  });
});

describe("membership state changes", () => {
  const staleMessage =
    "This subscription changed while you were confirming it. Nothing was charged — submit again.";
  const covenantId = "a".repeat(64);

  function gatewayThatThrows(error: Error): MembershipGateway {
    return {
      prepareOffer: async () => {
        throw error;
      },
      prepareMint: async () => {
        throw error;
      },
      preparePriceUpdate: async () => {
        throw error;
      },
      prepareCancellation: async () => {
        throw error;
      },
      submit: async () => {
        throw error;
      },
    };
  }

  function gatewayThatConfirms(): MembershipGateway {
    return {
      ...gatewayThatThrows(new Error("unused")),
      submit: async () => ({
        isAccepted: true,
        transactionId: "tx-1",
        rejection: null,
      }),
    };
  }

  async function creatorSession(store: MemoryStore) {
    const creator = `kaspatest:${"c".repeat(60)}`;
    await store.createSession({
      id: "creator-session",
      address: creator,
      expiresAt: Date.now() + 60_000,
    });
    return creator;
  }

  async function seedPrepared(
    store: MemoryStore,
    creator: string,
    kind: "offer" | "purchase" | "update" | "cancel",
  ) {
    await store.savePreparedMembership({
      id: "prepared-1",
      transaction: "{}",
      fingerprint: "fp",
      covenantId,
      signInputs: [],
      memberOutputIndex: null,
      creator,
      buyer: creator,
      kind,
      expiresAt: Date.now() + 60_000,
      priceSompi: "1000000000",
    });
  }

  function appWithGateway(store: MemoryStore, membershipGateway?: MembershipGateway) {
    return testApp(
      store,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      membershipGateway,
    );
  }

  it.each([
    ["price/prepare", "/api/membership/price/prepare", { price: "10" }],
    ["cancel/prepare", "/api/membership/cancel/prepare", {}],
  ])("reports a moved covenant on %s as retryable", async (_name, path, body) => {
    const store = new MemoryStore();
    const creator = await creatorSession(store);
    await store.saveCreatorCovenant({ creator, covenantId, priceSompi: "1000000000" });
    const { app } = appWithGateway(
      store,
      gatewayThatThrows(new MembershipStateChangedError()),
    );

    const response = await request(app)
      .post(path)
      .set("Cookie", "kaskama_session=creator-session")
      .send(body);

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      error: "MEMBERSHIP_OFFER_STALE",
      retry: "AFTER_REFRESH",
      message: staleMessage,
    });
  });

  it("reports a moved covenant while opening an offer", async () => {
    const store = new MemoryStore();
    await creatorSession(store);
    const { app } = appWithGateway(
      store,
      gatewayThatThrows(new MembershipStateChangedError()),
    );

    const response = await request(app)
      .post("/api/membership/offers/prepare")
      .set("Cookie", "kaskama_session=creator-session")
      .send({ price: "10" });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      error: "MEMBERSHIP_OFFER_STALE",
      retry: "AFTER_REFRESH",
      message: staleMessage,
    });
  });

  it("reports a moved covenant while subscribing", async () => {
    const store = new MemoryStore();
    const creator = await creatorSession(store);
    await store.saveCreatorCovenant({ creator, covenantId, priceSompi: "1000000000" });
    const buyer = `kaspatest:${"d".repeat(60)}`;
    await store.createSession({
      id: "buyer-session",
      address: buyer,
      expiresAt: Date.now() + 60_000,
    });
    const { app } = appWithGateway(
      store,
      gatewayThatThrows(new MembershipStateChangedError()),
    );

    const response = await request(app)
      .post(`/api/membership/${encodeURIComponent(creator)}/prepare`)
      .set("Cookie", "kaskama_session=buyer-session");

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      error: "MEMBERSHIP_OFFER_STALE",
      retry: "AFTER_REFRESH",
      message: staleMessage,
    });
  });

  it("still reports insufficient funds without a retry hint", async () => {
    const store = new MemoryStore();
    const creator = await creatorSession(store);
    await store.saveCreatorCovenant({ creator, covenantId, priceSompi: "1000000000" });
    const { app } = appWithGateway(
      store,
      gatewayThatThrows(new Error("INSUFFICIENT_FUNDS")),
    );

    const response = await request(app)
      .post("/api/membership/price/prepare")
      .set("Cookie", "kaskama_session=creator-session")
      .send({ price: "10" });

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ error: "INSUFFICIENT_FUNDS" });
    expect(response.body.retry).toBeUndefined();
  });

  it.each([
    ["update", "/api/membership/price/prepared-1/finalize"],
    ["cancel", "/api/membership/cancel/prepared-1/finalize"],
  ] as const)("reports a moved covenant while confirming a %s", async (kind, path) => {
    const store = new MemoryStore();
    const creator = await creatorSession(store);
    await store.saveCreatorCovenant({ creator, covenantId, priceSompi: "1000000000" });
    await seedPrepared(store, creator, kind);
    const { app } = appWithGateway(
      store,
      gatewayThatThrows(new MembershipStateChangedError()),
    );

    const response = await request(app)
      .post(path)
      .set("Cookie", "kaskama_session=creator-session")
      .send({ signedTransaction: "aa01" });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      error: "MEMBERSHIP_OFFER_STALE",
      retry: "AFTER_REFRESH",
      message: staleMessage,
    });
    expect(await store.getPreparedMembership("prepared-1", Date.now())).toBeNull();
  });

  it("explains a price update that no longer matches the covenant", async () => {
    const store = new MemoryStore();
    const creator = await creatorSession(store);
    await seedPrepared(store, creator, "update");
    const { app } = appWithGateway(store, gatewayThatConfirms());

    const response = await request(app)
      .post("/api/membership/price/prepared-1/finalize")
      .set("Cookie", "kaskama_session=creator-session")
      .send({ signedTransaction: "aa01" });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      error: "MEMBERSHIP_PRICE_UPDATE_STALE",
      retry: "AFTER_REFRESH",
      message: staleMessage,
    });
  });
});

describe("network configuration", () => {
  it("serves the default testnet network to the browser", async () => {
    const { app } = testApp();
    const response = await request(app).get("/api/config");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      network: "testnet-10",
      walletNetwork: "kaspa_testnet_10",
      addressPrefix: "kaspatest",
    });
  });

  it("serves the selected network without trusting the client", async () => {
    const store = new MemoryStore();
    const app = createApp({
      store,
      storage: {
        putFile: async () => undefined,
        readRange: async () => ({
          bytes: new Uint8Array(),
          size: 0,
          contentType: "image/jpeg",
        }),
        delete: async () => undefined,
      },
      walletVerifier: { verify: async () => false },
      publicOrigin: "http://localhost:5173",
      network: "mainnet",
    });

    const response = await request(app).get("/api/config");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      network: "mainnet",
      walletNetwork: "kaspa_mainnet",
      addressPrefix: "kaspa",
    });
  });
});

function testApp(
  store: Repositories = new MemoryStore(),
  paymentGateway?: PaymentGateway,
  metrics?: Metrics,
  storageOverride?: ObjectStorage,
  verifyMediaOverride?: (path: string) => Promise<VerifiedMedia>,
  membershipVerifier?: MembershipVerifier,
  membershipGateway?: MembershipGateway,
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
  const storage: ObjectStorage = storageOverride ?? {
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
    ...(verifyMediaOverride ? { verifyMedia: verifyMediaOverride } : {}),
    ...(membershipVerifier ? { membershipVerifier } : {}),
    ...(membershipGateway ? { membershipGateway } : {}),
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

describe("Crawler discoverability", () => {
  it("serves robots.txt that points crawlers at the sitemap", async () => {
    const { app } = testApp();

    const response = await request(app).get("/robots.txt");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.text).toContain("User-agent: *");
    expect(response.text).toContain("Sitemap: http://localhost:5173/sitemap.xml");
    expect(response.text).not.toContain("<div id=\"root\">");
  });

  it("serves an XML sitemap listing the public pages", async () => {
    const { app } = testApp();

    const response = await request(app).get("/sitemap.xml");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("xml");
    expect(response.text).toContain("<loc>http://localhost:5173/</loc>");
    expect(response.text).toContain("<loc>http://localhost:5173/creators</loc>");
    expect(response.text).not.toContain("<div id=\"root\">");
  });
});

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <title>Kaskama — Get paid directly by your fans and keep 99%</title>
    <meta
      name="description"
      content="Kaskama lets creators publish paid photos and videos."
    />
    <link rel="canonical" href="https://kaskama.com/" />
    <meta property="og:title" content="Kaskama" />
    <meta property="og:description" content="Publish paid photos and videos." />
    <meta property="og:url" content="https://kaskama.com/" />
    <meta name="twitter:title" content="Kaskama" />
    <meta name="twitter:description" content="Publish paid photos and videos." />
  </head>
  <body>
    <div id="root"><div class="home-page">home</div></div>
  </body>
</html>`;

describe("Server-rendered public pages", () => {
  const origin = "https://kaskama.test";
  let frontendDir: string;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    frontendDir = await mkdtemp(join(tmpdir(), "kaskama-frontend-"));
    await writeFile(join(frontendDir, "index.html"), INDEX_HTML);
    app = createApp({
      store: new MemoryStore(),
      storage: {
        putFile: async () => undefined,
        readRange: async () => ({
          bytes: new Uint8Array(),
          size: 0,
          contentType: "image/jpeg",
        }),
        delete: async () => undefined,
      },
      walletVerifier: { verify: async () => false },
      publicOrigin: origin,
      production: true,
      frontendDir,
    });
  });

  afterAll(async () => {
    await rm(frontendDir, { recursive: true, force: true });
  });

  it("describes a deep link instead of echoing the homepage", async () => {
    const response = await request(app).get("/creators");

    expect(response.status).toBe(200);
    expect(response.text).toContain("<title>Creators — Kaskama</title>");
    expect(response.text).toContain(`href="${origin}/creators"`);
    expect(response.text).toContain("Browse creators publishing");
    expect(response.text).not.toContain(
      '<link rel="canonical" href="https://kaskama.com/"',
    );
  });

  it.each(PUBLIC_PAGES)(
    "serves a distinct document at $path",
    async (page) => {
      const response = await request(app).get(page.path);

      expect(response.status).toBe(200);
      expect(response.text).toContain(`<title>${page.title}</title>`);
      expect(response.text).toContain(`href="${origin}${page.path}"`);
      expect(response.text).toContain(`<h1>${page.heading}</h1>`);
      expect(response.text).toContain(
        `<p class="legal-updated">Last updated: ${page.updated}</p>`,
      );
      expect(response.text).not.toContain('id="root"><div class="home-page"');
    },
  );

  it("marks unknown routes as not found", async () => {
    const response = await request(app).get("/for-ai-creators");

    expect(response.status).toBe(404);
    expect(response.text).toContain("<title>Page not found — Kaskama</title>");
    expect(response.text).toContain('id="root"><div class="message">');
    expect(response.text).not.toContain('class="home-page"');
    expect(response.text).not.toContain('rel="canonical"');
    expect(response.text).toContain('name="robots" content="noindex"');
  });

  it("keeps dynamic creator and post routes reachable", async () => {
    const creator = await request(app).get("/creator/kaspatest:abc");
    const post = await request(app).get("/post/abc");

    expect(creator.status).toBe(200);
    expect(post.status).toBe(200);
  });

  it("lists every public document in the sitemap", async () => {
    const response = await request(app).get("/sitemap.xml");

    for (const page of PUBLIC_PAGES) {
      expect(response.text).toContain(`<loc>${origin}${page.path}</loc>`);
    }
  });
});
