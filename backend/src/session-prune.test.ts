import request from "supertest";
import { createApp } from "./app.js";
import { LibsqlStore } from "./libsql-store.js";
import { MemoryStore } from "./memory-store.js";
import type { Challenge, Session } from "./domain.js";

const address = "kaspatest:qrzjdw58hp75mvvx6aq58kjyg3xjk7pt0k8txpll9sxdary9npn8v3pmkukdl";
const publicOrigin = "https://onlykas.test";
const now = 1_000_000;

function session(id: string, expiresAt: number): Session {
  return { id, address, expiresAt };
}

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

describe("session pruning", () => {
  it("deletes expired sessions while keeping live ones (memory)", async () => {
    const store = new MemoryStore();
    const expired = session("expired", now - 1);
    const live = session("live", now + 60_000);
    await store.createSession(expired);
    await store.createSession(live);

    await store.pruneSessions(now);

    expect(store.sessions.has(expired.id)).toBe(false);
    expect(store.sessions.has(live.id)).toBe(true);
  });

  it("deletes expired sessions while keeping live ones (libsql)", async () => {
    const store = new LibsqlStore("file::memory:");
    await store.initialize();
    const expired = session("expired", now - 1);
    const live = session("live", now + 60_000);
    await store.createSession(expired);
    await store.createSession(live);

    await store.pruneSessions(now);

    expect(await store.getSession(expired.id, now)).toBeNull();
    expect(await store.getSession(live.id, now)).not.toBeNull();
  });
});

describe("session pruning on sign-in", () => {
  it("sweeps expired sessions when a new session is created", async () => {
    const store = new MemoryStore();
    const expired = session("stale", now - 1);
    await store.createSession(expired);
    const challengeId = "00000000-0000-4000-8000-000000000000";
    await store.createChallenge(challenge(challengeId, now + 60_000));
    const app = createApp({
      store,
      storage: {
        putFile: async () => undefined,
        readRange: async () => ({ bytes: new Uint8Array(), size: 0, contentType: "image/jpeg" }),
        delete: async () => undefined,
      },
      walletVerifier: { verify: async () => true },
      publicOrigin,
      now: () => now,
    });

    await request(app)
      .post("/api/auth/session")
      .set("Origin", publicOrigin)
      .send({ challengeId, address, publicKey: "a".repeat(64), signature: "sig" })
      .expect(201);

    expect(store.sessions.has(expired.id)).toBe(false);
  });
});