import request from "supertest";
import { createApp } from "./app.js";
import { LibsqlStore } from "./libsql-store.js";
import { MemoryStore } from "./memory-store.js";
import type { Challenge } from "./domain.js";

const address = "kaspatest:qrzjdw58hp75mvvx6aq58kjyg3xjk7pt0k8txpll9sxdary9npn8v3pmkukdl";
const publicOrigin = "https://onlykas.test";
const now = 1_000_000;

function challenge(id: string, expiresAt: number): Challenge {
  return {
    id,
    nonce: id.padEnd(64, "0").slice(0, 64),
    address,
    origin: publicOrigin,
    network: "kaspa_testnet_10",
    message: `message-${id}`,
    expiresAt,
    consumedAt: null,
  };
}

describe("challenge pruning", () => {
  it("deletes consumed and expired challenges while keeping live ones (memory)", async () => {
    const store = new MemoryStore();
    const expired = challenge("expired", now - 1);
    const consumed = challenge("consumed", now + 60_000);
    const live = challenge("live", now + 60_000);
    await store.createChallenge(expired);
    await store.createChallenge(consumed);
    await store.createChallenge(live);
    expect(await store.consumeChallenge(consumed.id, now)).not.toBeNull();

    await store.pruneChallenges(now);

    expect(store.challenges.has(expired.id)).toBe(false);
    expect(store.challenges.has(consumed.id)).toBe(false);
    expect(store.challenges.has(live.id)).toBe(true);
  });

  it("deletes consumed and expired challenges while keeping live ones (libsql)", async () => {
    const store = new LibsqlStore("file::memory:");
    await store.initialize();
    const expired = challenge("expired", now - 1);
    const consumed = challenge("consumed", now + 60_000);
    const live = challenge("live", now + 60_000);
    await store.createChallenge(expired);
    await store.createChallenge(consumed);
    await store.createChallenge(live);
    expect(await store.consumeChallenge(consumed.id, now)).not.toBeNull();

    await store.pruneChallenges(now);

    await expect(store.createChallenge(expired)).resolves.toBeUndefined();
    await expect(store.createChallenge(consumed)).resolves.toBeUndefined();
    await expect(store.createChallenge(live)).rejects.toThrow();
  });
});

describe("challenge pruning on sign-in", () => {
  it("sweeps expired challenges when a new challenge is issued", async () => {
    const store = new MemoryStore();
    const expired = challenge("stale", now - 1);
    await store.createChallenge(expired);
    const app = createApp({
      store,
      storage: {
        putFile: async () => undefined,
        readRange: async () => ({ bytes: new Uint8Array(), size: 0, contentType: "image/jpeg" }),
        delete: async () => undefined,
      },
      walletVerifier: { verify: async () => false },
      publicOrigin,
      now: () => now,
    });

    await request(app)
      .post("/api/auth/challenge")
      .set("Origin", publicOrigin)
      .send({ address })
      .expect(201);

    expect(store.challenges.has(expired.id)).toBe(false);
  });
});
