import request from "supertest";
import sharp from "sharp";
import { COPY } from "@onlykas/shared";
import { createApp } from "./app.js";
import type {
  CovenantGateway,
  PaymentGateway,
  Post,
  Upload,
} from "./domain.js";
import { LibsqlStore } from "./libsql-store.js";
import { MemoryStore } from "./memory-store.js";
import { TestStorage } from "./test-storage.js";
import { MEMBERSHIP_DURATION_MS } from "./covenant.js";
import {
  canonicalMembershipCovenantId,
  KaspaMembershipVerifier,
} from "./verifier.js";
import {
  processNextUpload,
  reconcilePendingMembershipMints,
  reconcilePendingMembershipTransfers,
} from "./worker.js";

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
      caption: "Private media",
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
    await store.commitPublication(upload.id, creator, post);
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
      caption: post.caption,
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
      caption: post.caption,
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
      .expect(409, {
        error: "ALREADY_UNLOCKED",
        message: "This post is already unlocked.",
      });
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
        caption: "  A private image.  ",
        priceKas: "1.00000001",
        permanenceConfirmed: true,
      })
      .expect(201);
    expect(published.body).toMatchObject({
      title: "First light",
      caption: "A private image.",
      priceSompi: "100000001",
      canView: true,
    });
    const verifiedUpload = (await store.getUpload(upload.id))!;
    const duplicateUpload: Upload = {
      ...verifiedUpload,
      id: "11111111-1111-4111-8111-111111111111",
      stagingKey: "staging/duplicate-upload",
      multipartId: "duplicate-multipart",
      state: "VERIFIED",
    };
    await store.createUpload(duplicateUpload);
    await creatorAgent
      .post("/api/posts")
      .send({
        uploadId: duplicateUpload.id,
        title: "Duplicate",
        caption: "Must not exist",
        priceKas: "1",
        permanenceConfirmed: true,
      })
      .expect(409, {
        error: "MEDIA_ALREADY_PUBLISHED",
        message: COPY.mediaAlreadyPublished,
      });
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

describe("membership offer deployment API", () => {
  function covenantGateway(): CovenantGateway {
    return {
      prepareDeploy: async () => ({
        transaction: JSON.stringify({
          id: "0".repeat(64),
          version: 0,
          inputs: [],
          outputs: [
            {
              value: "1",
              scriptPublicKey: "0000" + "20" + "b".repeat(64) + "ac",
              covenant: {
                type: "KCC-0020",
                payload: JSON.stringify({ type: "DEPLOY_COVENANT" }),
              },
            },
          ],
          subnetworkId: "0".repeat(40),
          lockTime: "0",
          gas: "0",
          storageMass: "20000",
          payload: "",
        }),
        fingerprint: "fingerprint",
        covenantId: "covenant-1",
      }),
      submitDeploy: async () => ({
        isAccepted: true,
        transactionId: "a".repeat(64),
        rejection: null,
      }),
      mint: async () => {
        throw new Error("unused");
      },
      transfer: async () => {
        throw new Error("unused");
      },
      submit: async () => {
        throw new Error("unused");
      },
      submitMint: async () => {
        throw new Error("unused");
      },
      status: async (transactionId: string) => ({
        isAccepted: true,
        transactionId,
        rejection: null,
        acceptedAt: null,
      }),
    };
  }

  it("deploys a live membership offer from a signed transaction", async () => {
    const store = new MemoryStore();
    const app = createApp({
      store,
      storage: new TestStorage(),
      publicOrigin: origin,
      walletVerifier: { verify: async () => true },
      covenantGateway: covenantGateway(),
    });
    const creatorAgent = request.agent(app);
    await authenticate(creatorAgent, creator);

    const proposed = await creatorAgent
      .post("/api/membership/offers/propose")
      .send({
        price: "1.5",
        description: "A day of access",
        payoutPk: "a".repeat(64),
      })
      .expect(201);
    expect(proposed.body).toMatchObject({
      state: "PREPARED",
      priceSompi: "150000000",
      description: "A day of access",
      covenantId: "covenant-1",
      transaction: expect.any(String),
    });
    expect(proposed.body.offer).toBeNull();

    const finalized = await creatorAgent
      .post(`/api/membership/deploys/${proposed.body.id}/finalize`)
      .send({ signedTransaction: "signed-by-wallet" })
      .expect(200);
    expect(finalized.body).toMatchObject({
      state: "CONFIRMED",
      transactionId: "a".repeat(64),
      offer: {
        id: proposed.body.id,
        creator,
        covenantId: "covenant-1",
        priceSompi: "150000000",
        description: "A day of access",
        isActive: true,
      },
    });
    expect(finalized.body.message).toBe(COPY.offerLive);

    const deploy = await creatorAgent
      .get(`/api/membership/deploys/${proposed.body.id}`)
      .expect(200);
    expect(deploy.body.state).toBe("CONFIRMED");

    const offers = await creatorAgent.get("/api/membership/offers").expect(200);
    expect(offers.body.offers).toHaveLength(1);
    expect(offers.body.offers[0]).toMatchObject({
      creator,
      covenantId: "covenant-1",
      priceSompi: "150000000",
      description: "A day of access",
      isActive: true,
    });

    await creatorAgent
      .post("/api/membership/offers/propose")
      .send({
        price: "2",
        description: "A different offer",
        payoutPk: "a".repeat(64),
      })
      .expect(409);
  });

  it("reuses an unchanged proposal and refuses to deploy without a gateway", async () => {
    const store = new MemoryStore();
    const app = createApp({
      store,
      storage: new TestStorage(),
      publicOrigin: origin,
      walletVerifier: { verify: async () => true },
      covenantGateway: covenantGateway(),
    });
    const creatorAgent = request.agent(app);
    await authenticate(creatorAgent, creator);

    const first = await creatorAgent
      .post("/api/membership/offers/propose")
      .send({
        price: "1",
        description: "Backstage",
        payoutPk: "a".repeat(64),
      })
      .expect(201);
    const reused = await creatorAgent
      .post("/api/membership/offers/propose")
      .send({
        price: "1",
        description: "Backstage",
        payoutPk: "a".repeat(64),
      })
      .expect(200);
    expect(reused.body.id).toBe(first.body.id);

    const noGateway = createApp({
      store: new MemoryStore(),
      storage: new TestStorage(),
      publicOrigin: origin,
      walletVerifier: { verify: async () => true },
    });
    const strandedAgent = request.agent(noGateway);
    await authenticate(strandedAgent, creator);
    const unavailable = await strandedAgent
      .post("/api/membership/offers/propose")
      .send({
        price: "1",
        description: "Backstage",
        payoutPk: "a".repeat(64),
      })
      .expect(503);
    expect(unavailable.body.message).toBe(COPY.membershipUnavailable);
  });

  it("rejects invalid offers and insufficient funding", async () => {
    const store = new MemoryStore();
    const app = createApp({
      store,
      storage: new TestStorage(),
      publicOrigin: origin,
      walletVerifier: { verify: async () => true },
      covenantGateway: {
        ...covenantGateway(),
        prepareDeploy: async () => {
          throw new Error("INSUFFICIENT_FUNDS");
        },
      },
    });
    const creatorAgent = request.agent(app);
    await authenticate(creatorAgent, creator);

    const invalid = await creatorAgent
      .post("/api/membership/offers/propose")
      .send({ price: "0", description: " ", payoutPk: "a".repeat(64) })
      .expect(400);
    expect(invalid.body.error).toBe("INVALID_OFFER");

    const unfunded = await creatorAgent
      .post("/api/membership/offers/propose")
      .send({
        price: "5",
        description: "Front row",
        payoutPk: "a".repeat(64),
      })
      .expect(422);
    expect(unfunded.body.error).toBe("INSUFFICIENT_FUNDS");
    expect(unfunded.body.message).toBe(COPY.insufficientFunds);
  });
});

describe("membership minting API", () => {
  const supporter = `kaspatest:${"s".repeat(60)}`;

  function mintPrepared(
    offer: { priceSompi: string; creator: string },
    buyer: string,
  ) {
    return {
      transaction: JSON.stringify({
        id: "0".repeat(64),
        version: 0,
        inputs: [],
        outputs: [
          {
            value: "1",
            scriptPublicKey: "000020" + "c".repeat(64) + "ac",
            covenant: {
              type: "KCC-0020",
              payload: JSON.stringify({ type: "MINT" }),
            },
          },
        ],
        subnetworkId: "0".repeat(40),
        lockTime: "0",
        gas: "0",
        storageMass: "20000",
        payload: "",
      }),
      fingerprint: "fingerprint",
      saleAmountSompi: offer.priceSompi,
      creatorRoyaltySompi: offer.priceSompi,
      seller: offer.creator,
      buyer,
    };
  }

  function mintingGateway(
    overrides: Partial<CovenantGateway> = {},
  ): CovenantGateway {
    return {
      prepareDeploy: async () => {
        throw new Error("unused");
      },
      submitDeploy: async () => {
        throw new Error("unused");
      },
      mint: async (offer, buyer) => mintPrepared(offer, buyer),
      transfer: async () => {
        throw new Error("unused");
      },
      submit: async () => {
        throw new Error("unused");
      },
      submitMint: async () => ({
        isAccepted: true,
        transactionId: "d".repeat(64),
        rejection: null,
        acceptedAt: null,
      }),
      status: async (transactionId: string) => ({
        isAccepted: true,
        transactionId,
        rejection: null,
        acceptedAt: null,
      }),
      ...overrides,
    };
  }

  async function seedLiveOffer(store: MemoryStore) {
    await store.saveCovenant({
      id: "covenant-1",
      templateJson: '{"type":"KCC-0020","amount":1}',
      templateFingerprint: "a".repeat(64),
      amount: "1",
      durationMs: 86400_000,
      creatorRoyaltyBps: 1000,
      createdAt: 1,
    });
    await store.createMembershipOffer({
      id: "offer-1",
      creator,
      covenantId: "covenant-1",
      priceSompi: "100",
      description: "A day of access",
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    });
  }

  it("proposes, finalizes, and serves the live membership with recovery and the public offer", async () => {
    const store = new MemoryStore();
    await seedLiveOffer(store);
    const app = createApp({
      store,
      storage: new TestStorage(),
      publicOrigin: origin,
      walletVerifier: { verify: async () => true },
      covenantGateway: mintingGateway(),
    });
    const supporterAgent = request.agent(app);
    await authenticate(supporterAgent, supporter);

    const proposed = await supporterAgent
      .post("/api/membership/offers/offer-1/mints/propose")
      .expect(201);
    expect(proposed.body).toMatchObject({
      state: "PREPARED",
      offerId: "offer-1",
      priceSompi: "100",
      transaction: expect.any(String),
      fingerprint: expect.any(String),
      membership: null,
    });

    const finalized = await supporterAgent
      .post(`/api/membership/mints/${proposed.body.id}/finalize`)
      .send({ signedTransaction: "signed-by-wallet" })
      .expect(200);
    expect(finalized.body).toMatchObject({
      state: "CONFIRMED",
      offerId: "offer-1",
      transactionId: "d".repeat(64),
      membership: {
        id: proposed.body.id,
        owner: supporter,
        creator,
        state: "ACTIVE",
      },
    });
    expect(finalized.body.message).toBe(COPY.membershipLive);

    const recovered = await supporterAgent
      .get(`/api/membership/mints/${proposed.body.id}`)
      .expect(200);
    expect(recovered.body.state).toBe("CONFIRMED");
    expect(recovered.body.membership.state).toBe("ACTIVE");
    expect(
      new Date(recovered.body.membership.validUntil).getTime() -
        new Date(recovered.body.membership.createdAt).getTime(),
    ).toBe(86400_000);

    const memberships = await supporterAgent
      .get("/api/membership/offers/offer-1/memberships")
      .expect(200);
    expect(memberships.body.memberships).toHaveLength(1);

    const publicOffer = await request(app)
      .get(`/api/membership/offers/${creator}`)
      .expect(200);
    expect(publicOffer.body.offer).toMatchObject({
      id: "offer-1",
      creator,
      priceSompi: "100",
    });
  });

  it("leaves an undecided transaction pending until the worker confirms it", async () => {
    const store = new MemoryStore();
    await seedLiveOffer(store);
    const gateway = mintingGateway({
      submitMint: async () => ({
        isAccepted: null,
        transactionId: "e".repeat(64),
        rejection: null,
        acceptedAt: null,
      }),
      status: async (transactionId: string) => ({
        isAccepted: true,
        transactionId,
        rejection: null,
        acceptedAt: 5_000,
      }),
    });
    const app = createApp({
      store,
      storage: new TestStorage(),
      publicOrigin: origin,
      walletVerifier: { verify: async () => true },
      covenantGateway: gateway,
    });
    const supporterAgent = request.agent(app);
    await authenticate(supporterAgent, supporter);

    const proposed = await supporterAgent
      .post("/api/membership/offers/offer-1/mints/propose")
      .expect(201);
    const pending = await supporterAgent
      .post(`/api/membership/mints/${proposed.body.id}/finalize`)
      .send({ signedTransaction: "signed-by-wallet" })
      .expect(202);
    expect(pending.body).toMatchObject({
      state: "PENDING",
      transactionId: "e".repeat(64),
      membership: null,
    });
    expect(pending.body.message).toBe(COPY.membershipPending);

    const stillPending = await supporterAgent
      .post("/api/membership/offers/offer-1/mints/propose")
      .expect(409);
    expect(stillPending.body.message).toBe(COPY.membershipPending);

    expect(await reconcilePendingMembershipMints(store, gateway, 20)).toBe(1);
    const confirmed = await supporterAgent
      .get(`/api/membership/mints/${proposed.body.id}`)
      .expect(200);
    expect(confirmed.body.state).toBe("CONFIRMED");
    expect(confirmed.body.membership).toMatchObject({
      id: proposed.body.id,
      owner: supporter,
      state: "ACTIVE",
    });
    expect(new Date(confirmed.body.membership.createdAt).getTime()).toBe(5_000);
  });

  it("starts a fresh mint when renewing after a confirmed membership", async () => {
    const store = new MemoryStore();
    await seedLiveOffer(store);
    const app = createApp({
      store,
      storage: new TestStorage(),
      publicOrigin: origin,
      walletVerifier: { verify: async () => true },
      covenantGateway: mintingGateway(),
    });
    const supporterAgent = request.agent(app);
    await authenticate(supporterAgent, supporter);

    const first = await supporterAgent
      .post("/api/membership/offers/offer-1/mints/propose")
      .expect(201);
    await supporterAgent
      .post(`/api/membership/mints/${first.body.id}/finalize`)
      .send({ signedTransaction: "signed-by-wallet" })
      .expect(200);
    const second = await supporterAgent
      .post("/api/membership/offers/offer-1/mints/propose")
      .expect(201);
    expect(second.body.id).not.toBe(first.body.id);
    expect(second.body.state).toBe("PREPARED");
  });

  it("rejects a prepared mint whose funded price does not match the offer", async () => {
    const store = new MemoryStore();
    await seedLiveOffer(store);
    const app = createApp({
      store,
      storage: new TestStorage(),
      publicOrigin: origin,
      walletVerifier: { verify: async () => true },
      covenantGateway: mintingGateway({
        mint: async (offer, buyer) => ({
          ...mintPrepared(offer, buyer),
          saleAmountSompi: "200",
        }),
      }),
    });
    const supporterAgent = request.agent(app);
    await authenticate(supporterAgent, supporter);

    const mismatch = await supporterAgent
      .post("/api/membership/offers/offer-1/mints/propose")
      .expect(400);
    expect(mismatch.body.error).toBe("MINT_PRICE_MISMATCH");
    expect(mismatch.body.message).toBe(COPY.membershipPriceMismatch);
    expect(
      await store.unresolvedMembershipMintAttempt("offer-1", supporter),
    ).toBeNull();
  });

  it("is unavailable without a covenant gateway", async () => {
    const store = new MemoryStore();
    await seedLiveOffer(store);
    const app = createApp({
      store,
      storage: new TestStorage(),
      publicOrigin: origin,
      walletVerifier: { verify: async () => true },
    });
    const supporterAgent = request.agent(app);
    await authenticate(supporterAgent, supporter);

    const propose = await supporterAgent
      .post("/api/membership/offers/offer-1/mints/propose")
      .expect(503);
    expect(propose.body.error).toBe("MEMBERSHIP_UNAVAILABLE");
    expect(propose.body.message).toBe(COPY.membershipUnavailable);
  });
});

describe("membership transfer API", () => {
  const seller = `kaspatest:${"s".repeat(60)}`;
  const buyer = `kaspatest:${"b".repeat(60)}`;

  function transferGateway(
    overrides: Partial<CovenantGateway> = {},
  ): CovenantGateway {
    return {
      prepareDeploy: async () => {
        throw new Error("unused");
      },
      submitDeploy: async () => {
        throw new Error("unused");
      },
      mint: async () => {
        throw new Error("unused");
      },
      transfer: async (_membership, _buyer, saleAmountSompi) => ({
        transaction: JSON.stringify({
          id: "0".repeat(64),
          version: 0,
          inputs: [],
          outputs: [
            {
              value: "1",
              scriptPublicKey: "000020" + "c".repeat(64) + "ac",
              covenant: {
                type: "KCC-0020",
                payload: JSON.stringify({ type: "TRANSFER" }),
              },
            },
          ],
          subnetworkId: "0".repeat(40),
          lockTime: "0",
          gas: "0",
          storageMass: "20000",
          payload: "",
        }),
        fingerprint: "transfer-fingerprint",
        saleAmountSompi,
        creatorRoyaltySompi: (BigInt(saleAmountSompi) / 10n).toString(),
        seller,
        buyer: _buyer,
      }),
      submit: async () => ({
        isAccepted: true,
        transactionId: "f".repeat(64),
        rejection: null,
        acceptedAt: null,
      }),
      submitMint: async () => {
        throw new Error("unused");
      },
      status: async (transactionId: string) => ({
        isAccepted: true,
        transactionId,
        rejection: null,
        acceptedAt: null,
      }),
      ...overrides,
    };
  }

  async function seedActiveMembership(
    store: MemoryStore,
    owner = seller,
    membershipId = "membership-1",
    validUntil = Date.now() + 86400_000,
    state: "ACTIVE" | "EXPIRED" = "ACTIVE",
  ) {
    await store.saveCovenant({
      id: "covenant-1",
      templateJson: '{"type":"KCC-0020","amount":1}',
      templateFingerprint: "a".repeat(64),
      amount: "1",
      durationMs: 86400_000,
      creatorRoyaltyBps: 1000,
      createdAt: 1,
    });
    await store.createMembershipOffer({
      id: "offer-1",
      creator,
      covenantId: "covenant-1",
      priceSompi: "100",
      description: "A day of access",
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    });
    await store.createMembership({
      id: membershipId,
      offerId: "offer-1",
      owner,
      creator,
      covenantId: "covenant-1",
      createdTxId: null,
      validUntil,
      state,
      createdAt: 1,
      updatedAt: 1,
    });
  }

  it("proposes, finalizes, and serves a transfer, then hands ownership to the buyer", async () => {
    const store = new MemoryStore();
    await seedActiveMembership(store);
    const app = createApp({
      store,
      storage: new TestStorage(),
      publicOrigin: origin,
      walletVerifier: { verify: async () => true },
      covenantGateway: transferGateway(),
    });
    const sellerAgent = request.agent(app);
    await authenticate(sellerAgent, seller);

    const proposed = await sellerAgent
      .post("/api/membership/memberships/membership-1/transfers/propose")
      .send({ recipient: buyer, saleAmount: "5" })
      .expect(201);
    expect(proposed.body).toMatchObject({
      state: "PREPARED",
      membershipId: "membership-1",
      seller,
      buyer,
      saleAmountSompi: "500000000",
      creatorRoyaltySompi: "50000000",
      creatorPayoutAddress: creator,
      transaction: expect.any(String),
      fingerprint: "transfer-fingerprint",
      membership: null,
    });

    const finalized = await sellerAgent
      .post(`/api/membership/transfers/${proposed.body.id}/finalize`)
      .send({ signedTransaction: "signed-by-wallet" })
      .expect(200);
    expect(finalized.body).toMatchObject({
      state: "CONFIRMED",
      transactionId: "f".repeat(64),
      membership: {
        id: "membership-1",
        owner: buyer,
        creator,
        state: "ACTIVE",
      },
    });
    expect(finalized.body.message).toBe(COPY.transferSent);

    const recovered = await sellerAgent
      .get(`/api/membership/transfers/${proposed.body.id}`)
      .expect(200);
    expect(recovered.body.state).toBe("CONFIRMED");
    expect(recovered.body.membership.owner).toBe(buyer);

    const buyersView = await store.getMembership("membership-1");
    expect(buyersView!.owner).toBe(buyer);
    expect(buyersView!.state).toBe("ACTIVE");
    expect(buyersView!.validUntil).toBeGreaterThan(Date.now());
  });

  it("rejects a transfer when the caller is not the holder", async () => {
    const store = new MemoryStore();
    await seedActiveMembership(store);
    const app = createApp({
      store,
      storage: new TestStorage(),
      publicOrigin: origin,
      walletVerifier: { verify: async () => true },
      covenantGateway: transferGateway(),
    });
    const outsiderAgent = request.agent(app);
    await authenticate(outsiderAgent, outsider);

    const res = await outsiderAgent
      .post("/api/membership/memberships/membership-1/transfers/propose")
      .send({ recipient: buyer, saleAmount: "5" })
      .expect(403);
    expect(res.body.error).toBe("TRANSFER_NOT_HOLDER");
    expect(res.body.message).toBe(COPY.transferNotHolder);
  });

  it("rejects a transfer of an expired membership", async () => {
    const store = new MemoryStore();
    await seedActiveMembership(
      store,
      seller,
      "membership-1",
      Date.now() - 1000,
      "EXPIRED",
    );
    const app = createApp({
      store,
      storage: new TestStorage(),
      publicOrigin: origin,
      walletVerifier: { verify: async () => true },
      covenantGateway: transferGateway(),
    });
    const sellerAgent = request.agent(app);
    await authenticate(sellerAgent, seller);

    const res = await sellerAgent
      .post("/api/membership/memberships/membership-1/transfers/propose")
      .send({ recipient: buyer, saleAmount: "5" })
      .expect(409);
    expect(res.body.error).toBe("TRANSFER_EXPIRED");
    expect(res.body.message).toBe(COPY.transferExpired);
  });

  it("rejects an invalid recipient and a non-positive amount", async () => {
    const store = new MemoryStore();
    await seedActiveMembership(store);
    const app = createApp({
      store,
      storage: new TestStorage(),
      publicOrigin: origin,
      walletVerifier: { verify: async () => true },
      covenantGateway: transferGateway(),
    });
    const sellerAgent = request.agent(app);
    await authenticate(sellerAgent, seller);

    const badRecipient = await sellerAgent
      .post("/api/membership/memberships/membership-1/transfers/propose")
      .send({ recipient: "not-an-address", saleAmount: "5" })
      .expect(422);
    expect(badRecipient.body.error).toBe("TRANSFER_INVALID_RECIPIENT");

    const self = await sellerAgent
      .post("/api/membership/memberships/membership-1/transfers/propose")
      .send({ recipient: seller, saleAmount: "5" })
      .expect(422);
    expect(self.body.error).toBe("TRANSFER_INVALID_RECIPIENT");

    const badAmount = await sellerAgent
      .post("/api/membership/memberships/membership-1/transfers/propose")
      .send({ recipient: buyer, saleAmount: "0" })
      .expect(422);
    expect(badAmount.body.error).toBe("TRANSFER_INVALID_AMOUNT");
  });

  it("leaves an undecided transfer pending until the worker confirms it", async () => {
    const store = new MemoryStore();
    await seedActiveMembership(store);
    const gateway = transferGateway({
      submit: async () => ({
        isAccepted: null,
        transactionId: "g".repeat(64),
        rejection: null,
        acceptedAt: null,
      }),
      status: async (transactionId: string) => ({
        isAccepted: true,
        transactionId,
        rejection: null,
        acceptedAt: 5_000,
      }),
    });
    const app = createApp({
      store,
      storage: new TestStorage(),
      publicOrigin: origin,
      walletVerifier: { verify: async () => true },
      covenantGateway: gateway,
    });
    const sellerAgent = request.agent(app);
    await authenticate(sellerAgent, seller);

    const proposed = await sellerAgent
      .post("/api/membership/memberships/membership-1/transfers/propose")
      .send({ recipient: buyer, saleAmount: "5" })
      .expect(201);
    const pending = await sellerAgent
      .post(`/api/membership/transfers/${proposed.body.id}/finalize`)
      .send({ signedTransaction: "signed-by-wallet" })
      .expect(202);
    expect(pending.body).toMatchObject({
      state: "PENDING",
      transactionId: "g".repeat(64),
      membership: null,
    });
    expect(pending.body.message).toBe(COPY.transferPending);

    expect(await reconcilePendingMembershipTransfers(store, gateway, 20)).toBe(
      1,
    );
    const confirmed = await sellerAgent
      .get(`/api/membership/transfers/${proposed.body.id}`)
      .expect(200);
    expect(confirmed.body.state).toBe("CONFIRMED");
    expect(confirmed.body.membership).toMatchObject({
      id: "membership-1",
      owner: buyer,
      state: "ACTIVE",
    });
  });

  it("is unavailable without a covenant gateway", async () => {
    const store = new MemoryStore();
    await seedActiveMembership(store);
    const app = createApp({
      store,
      storage: new TestStorage(),
      publicOrigin: origin,
      walletVerifier: { verify: async () => true },
    });
    const sellerAgent = request.agent(app);
    await authenticate(sellerAgent, seller);

    const res = await sellerAgent
      .post("/api/membership/memberships/membership-1/transfers/propose")
      .send({ recipient: buyer, saleAmount: "5" })
      .expect(503);
    expect(res.body.error).toBe("TRANSFER_UNAVAILABLE");
    expect(res.body.message).toBe(COPY.transferUnavailable);
  });
});

describe("membership on-chain verification API", () => {
  const scanned = `kaspatest:${"v".repeat(60)}`;
  const member = `kaspatest:${"w".repeat(60)}`;
  const createdAt = 1_700_000_000_000;
  const NOW = createdAt + MEMBERSHIP_DURATION_MS / 2;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function tokenCovenant(overrides: Record<string, unknown> = {}) {
    return {
      type: "KCC-0020",
      payload: {
        type: "MINT",
        owner: member,
        offerId: "offer-1",
        creator: scanned,
        created_at: createdAt,
        valid_until: createdAt + MEMBERSHIP_DURATION_MS,
        ...overrides,
      },
    };
  }

  function mockMembershipNode(
    transactionId: string,
    covenant: unknown,
    index = 0,
  ) {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith(`/addresses/${encodeURIComponent(scanned)}/utxos`))
        return new Response(
          JSON.stringify([
            {
              outpoint: { transactionId, index },
              utxoEntry: { amount: "1" },
            },
          ]),
        );
      if (url.endsWith(`/transactions/${transactionId}`)) {
        const outputs: Record<string, unknown>[] = [];
        outputs[index] = { covenant };
        return new Response(JSON.stringify({ outputs }));
      }
      throw new Error(`unexpected URL ${url}`);
    });
  }

  function verificationApp() {
    return createApp({
      store: new MemoryStore(),
      storage: new TestStorage(),
      publicOrigin: origin,
      walletVerifier: { verify: async () => true },
      membershipVerifier: new KaspaMembershipVerifier(
        "https://kaspa.test",
        () => NOW,
      ),
    });
  }

  it("validates a live membership token directly from the chain", async () => {
    const transactionId = "0".repeat(64);
    mockMembershipNode(transactionId, tokenCovenant());

    const res = await request(verificationApp())
      .get(`/api/verify/membership/address/${scanned}`)
      .expect(200);

    expect(res.body).toMatchObject({
      address: scanned,
      valid: true,
    });
    expect(res.body.memberships).toHaveLength(1);
    expect(res.body.memberships[0]).toMatchObject({
      transactionId,
      outputIndex: 0,
      covenantId: canonicalMembershipCovenantId(),
      kind: "token",
      tokenType: "MINT",
      owner: member,
      status: "VALID",
    });
    expect(res.body.memberships[0].validUntil).toBe(
      new Date(createdAt + MEMBERSHIP_DURATION_MS).toISOString(),
    );
  });

  it("flags a scanned token for the wrong owner", async () => {
    mockMembershipNode("1".repeat(64), tokenCovenant());

    const res = await request(verificationApp())
      .get(`/api/verify/membership/address/${scanned}?owner=${outsider}`)
      .expect(200);

    expect(res.body.valid).toBe(false);
    expect(res.body.memberships[0].status).toBe("OWNER_MISMATCH");
  });

  it("verifies a single utxo by transaction id and output index", async () => {
    const transactionId = "2".repeat(64);
    mockMembershipNode(transactionId, tokenCovenant(), 3);

    const res = await request(verificationApp())
      .get(`/api/verify/membership/utxo/${transactionId}/3?owner=${member}`)
      .expect(200);

    expect(res.body).toMatchObject({
      transactionId,
      outputIndex: 3,
      status: "VALID",
      owner: member,
    });
  });

  it("reports expired memberships", async () => {
    const transactionId = "3".repeat(64);
    mockMembershipNode(
      transactionId,
      tokenCovenant({
        valid_until: createdAt - 1,
        created_at: createdAt - 1 - MEMBERSHIP_DURATION_MS,
      }),
    );

    const res = await request(verificationApp())
      .get(`/api/verify/membership/address/${scanned}`)
      .expect(200);

    expect(res.body.valid).toBe(false);
    expect(res.body.memberships[0].status).toBe("EXPIRED");
  });

  it("is unavailable without a verifier", async () => {
    const app = createApp({
      store: new MemoryStore(),
      storage: new TestStorage(),
      publicOrigin: origin,
      walletVerifier: { verify: async () => true },
    });
    const res = await request(app)
      .get(`/api/verify/membership/address/${scanned}`)
      .expect(503);
    expect(res.body.error).toBe("VERIFY_UNAVAILABLE");
  });

  it("rejects an invalid address and utxo parameters", async () => {
    const badAddress = await request(verificationApp())
      .get("/api/verify/membership/address/not-an-address")
      .expect(400);
    expect(badAddress.body.error).toBe("INVALID_ADDRESS");

    const badOwner = await request(verificationApp())
      .get(`/api/verify/membership/address/${scanned}?owner=not-an-address`)
      .expect(400);
    expect(badOwner.body.error).toBe("INVALID_ADDRESS");

    const badTransaction = await request(verificationApp())
      .get(`/api/verify/membership/utxo/short/0`)
      .expect(400);
    expect(badTransaction.body.error).toBe("INVALID_REQUEST");

    const badIndex = await request(verificationApp())
      .get(`/api/verify/membership/utxo/${"4".repeat(64)}/-1`)
      .expect(400);
    expect(badIndex.body.error).toBe("INVALID_REQUEST");
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
