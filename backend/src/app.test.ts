import request from "supertest";
import sharp from "sharp";
import { COPY } from "@onlykas/shared";
import { createApp } from "./app.js";
import type { PaymentGateway, Post, Upload } from "./domain.js";
import { LibsqlStore } from "./libsql-store.js";
import { MemoryStore } from "./memory-store.js";
import { TestStorage } from "./test-storage.js";
import { processNextUpload } from "./worker.js";

const origin = "https://onlykas.test";
const creator = `kaspatest:${"q".repeat(60)}`;
const outsider = `kaspatest:${"r".repeat(60)}`;

describe("creator publication API", () => {
  it("returns health and readiness with a correlation ID", async () => {
    const app = createApp({
      store: new MemoryStore(),
      storage: new TestStorage(),
      publicOrigin: origin,
      walletVerifier: { verify: async () => true },
      readinessCheck: () => false,
    });
    await request(app)
      .get("/healthz")
      .set("X-Request-Id", "test-trace")
      .expect(200)
      .expect("X-Request-Id", "test-trace")
      .expect({ status: "ok" });
    await request(app).get("/readyz").expect(503, { status: "unready" });
  });

  it("confirms one supporter payment and grants permanent media access", async () => {
    const store = new MemoryStore();
    const storage = new TestStorage();
    const post: Post = {
      id: "paid-post",
      creator,
      title: "Paid release",
      description: "Private media",
      priceSompi: "100",
      mediaType: "image/png",
      mediaSize: 4,
      mediaDigest: "digest",
      mediaKey: "final/digest",
      publishedAt: 1_000,
    };
    const upload: Upload = {
      id: "upload",
      creator,
      stagingKey: "staging/upload",
      multipartId: "multipart",
      state: "VERIFIED",
      hintedType: "image/png",
      hintedSize: 4,
      expiresAt: 2_000,
      updatedAt: 1_000,
      error: null,
      digest: "digest",
      mediaType: "image/png",
      mediaSize: 4,
      finalKey: "final/digest",
      parts: [],
    };
    await store.createUpload(upload);
    await store.publish(upload.id, post);
    storage.objects.set(post.mediaKey, {
      bytes: new Uint8Array([1, 2, 3, 4]),
      contentType: post.mediaType,
    });
    const gateway: PaymentGateway = {
      prepare: async () => ({
        transaction: JSON.stringify({
          outputs: [{ scriptPublicKey: "000020" }],
        }),
        fingerprint: "fingerprint",
        amountSompi: post.priceSompi,
        creator: post.creator,
      }),
      submit: async () => ({
        isAccepted: true,
        transactionId: "a".repeat(64),
        rejection: null,
      }),
      status: async (transactionId) => ({
        isAccepted: true,
        transactionId,
        rejection: null,
      }),
    };
    const app = createApp({
      store,
      storage,
      publicOrigin: origin,
      paymentGateway: gateway,
      walletVerifier: { verify: async () => true },
    });
    const buyerAgent = request.agent(app);
    await authenticate(buyerAgent, outsider);
    await buyerAgent.get(`/api/posts/${post.id}`).expect(200, {
      id: post.id,
      creator: post.creator,
      title: post.title,
      description: post.description,
      priceSompi: post.priceSompi,
      mediaType: post.mediaType,
      publishedAt: new Date(post.publishedAt).toISOString(),
      canView: false,
    });
    const prepared = await buyerAgent
      .post(`/api/posts/${post.id}/payments/prepare`)
      .expect(201);
    await buyerAgent
      .post(`/api/payments/${prepared.body.id}/finalize`)
      .send({ signedTransaction: "signed-by-wallet" })
      .expect(200);
    await buyerAgent.get(`/api/posts/${post.id}`).expect(200, {
      id: post.id,
      creator: post.creator,
      title: post.title,
      description: post.description,
      priceSompi: post.priceSompi,
      mediaType: post.mediaType,
      publishedAt: new Date(post.publishedAt).toISOString(),
      canView: true,
    });
    await buyerAgent
      .get(`/api/posts/${post.id}/media`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toEqual(Buffer.from([1, 2, 3, 4]));
      });
    await buyerAgent
      .post(`/api/posts/${post.id}/payments/prepare`)
      .expect(409, { error: "ALREADY_UNLOCKED" });
  });

  it("authenticates, verifies private media, publishes immutably, and serves only its creator", async () => {
    const store = new LibsqlStore("file::memory:");
    await store.initialize();
    const storage = new TestStorage();
    const app = createApp({
      store,
      storage,
      publicOrigin: origin,
      now: () => 1_000,
      walletVerifier: {
        verify: async (message, signature, publicKey, address) =>
          signature === `signed:${message}` &&
          publicKey === "a".repeat(64) &&
          address === creator,
      },
    });
    const creatorAgent = request.agent(app);
    await authenticate(creatorAgent, creator);

    const created = await creatorAgent
      .post("/api/uploads")
      .send({ name: "release.png", type: "image/png", size: 100 })
      .expect(201);
    const upload = (await store.getUpload(created.body.id as string))!;
    storage.objects.set(upload.stagingKey, {
      bytes: new Uint8Array(
        await sharp({
          create: { width: 1, height: 1, channels: 4, background: "#ff0000" },
        })
          .png()
          .toBuffer(),
      ),
      contentType: "image/png",
    });
    await creatorAgent
      .post(`/api/uploads/${upload.id}/parts`)
      .send({ partNumber: 1 })
      .expect(200);
    await creatorAgent
      .post(`/api/uploads/${upload.id}/parts`)
      .send({ partNumber: 2 })
      .expect(200);
    await creatorAgent
      .post(`/api/uploads/${upload.id}/complete`)
      .send({ parts: [{ partNumber: 1, etag: "etag-1" }] })
      .expect(200);
    expect(await processNextUpload(store, storage, 1_001)).toBe(true);
    expect((await store.getUpload(upload.id))?.state).toBe("VERIFIED");

    const published = await creatorAgent
      .post("/api/posts")
      .send({
        uploadId: upload.id,
        title: "  First light  ",
        description: "  A private image.  ",
        priceKas: "1.00000001",
        permanenceConfirmed: true,
      })
      .expect(201);
    expect(published.body).toMatchObject({
      title: "First light",
      description: "A private image.",
      priceSompi: "100000001",
      canView: true,
    });
    await creatorAgent
      .post("/api/posts")
      .send({
        uploadId: upload.id,
        title: "Duplicate",
        description: "Must not exist",
        priceKas: "1",
        permanenceConfirmed: true,
      })
      .expect(409);
    expect(await store.creatorPosts(creator)).toHaveLength(1);

    const profile = await request(app)
      .get(`/api/creators/${creator}`)
      .expect(200);
    expect(profile.body.posts).toHaveLength(1);
    expect(profile.body.posts[0]).toMatchObject({
      canView: false,
      title: "First light",
    });

    const beforeUnauthorizedRead = storage.readCount;
    const outsiderApp = createApp({
      store,
      storage,
      publicOrigin: origin,
      now: () => 1_000,
      walletVerifier: { verify: async () => true },
    });
    const outsiderSession = request.agent(outsiderApp);
    await authenticate(outsiderSession, outsider);
    await outsiderSession
      .get(`/api/posts/${published.body.id}/media`)
      .expect(403);
    expect(storage.readCount).toBe(beforeUnauthorizedRead);

    const media = await creatorAgent
      .get(`/api/posts/${published.body.id}/media`)
      .set("Range", "bytes=0-7")
      .expect(206);
    expect(media.headers["content-range"]).toMatch(/^bytes 0-7\//);
    expect(media.body).toHaveLength(8);
  });

  it("rejects replayed, expired, cross-origin, and invalid wallet proofs", async () => {
    let now = 1_000;
    const store = new MemoryStore();
    const app = createApp({
      store,
      storage: new TestStorage(),
      publicOrigin: origin,
      now: () => now,
      walletVerifier: { verify: async () => false },
    });
    await request(app)
      .post("/api/auth/challenge")
      .set("Origin", "https://evil.test")
      .send({ address: creator })
      .expect(403);
    const challenge = await request(app)
      .post("/api/auth/challenge")
      .set("Origin", origin)
      .send({ address: creator })
      .expect(201);
    await request(app)
      .post("/api/auth/session")
      .set("Origin", origin)
      .send({
        challengeId: challenge.body.challengeId,
        address: creator,
        publicKey: "a".repeat(64),
        signature: "bad",
      })
      .expect(401);
    await request(app)
      .post("/api/auth/session")
      .set("Origin", origin)
      .send({
        challengeId: challenge.body.challengeId,
        address: creator,
        publicKey: "a".repeat(64),
        signature: "bad",
      })
      .expect(401);
    const expired = await request(app)
      .post("/api/auth/challenge")
      .set("Origin", origin)
      .send({ address: creator })
      .expect(201);
    now += 300_001;
    const result = await request(app)
      .post("/api/auth/session")
      .set("Origin", origin)
      .send({
        challengeId: expired.body.challengeId,
        address: creator,
        publicKey: "a".repeat(64),
        signature: "bad",
      })
      .expect(401);
    expect(result.body.message).toBe(COPY.verificationFailed);
  });
});

async function authenticate(
  agent: ReturnType<typeof request.agent>,
  address: string,
) {
  const challenge = await agent
    .post("/api/auth/challenge")
    .set("Origin", origin)
    .send({ address })
    .expect(201);
  return agent
    .post("/api/auth/session")
    .set("Origin", origin)
    .send({
      challengeId: challenge.body.challengeId,
      address,
      publicKey: "a".repeat(64),
      signature: `signed:${challenge.body.message}`,
    })
    .expect(201);
}
