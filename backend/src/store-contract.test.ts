import { LibsqlStore } from "./libsql-store.js";
import { MemoryStore } from "./memory-store.js";
import type { Post } from "./domain/models.js";
import type { Repositories } from "./application/ports.js";

const now = 1_000_000;
const creator = "kaspatest:creator";
const buyer = "kaspatest:buyer";

describe.each([
  ["memory", () => new MemoryStore()],
  ["libsql", () => new LibsqlStore("file::memory:")],
])("store contract: %s", (_name, createStore) => {
  let store: Repositories;

  beforeEach(async () => {
    store = createStore();
    await store.initialize();
  });

  it("consumes each unexpired challenge exactly once", async () => {
    const challenge = {
      id: "challenge-1",
      nonce: "nonce-1",
      address: creator,
      origin: "http://localhost:5173",
      network: "kaspa_testnet_10",
      message: "Sign this message",
      expiresAt: now + 1_000,
      consumedAt: null,
    };

    await store.createChallenge(challenge);

    expect(await store.consumeChallenge(challenge.id, now)).toEqual({
      ...challenge,
      consumedAt: now,
    });
    expect(await store.consumeChallenge(challenge.id, now)).toBeNull();
  });

  it("rejects an expired challenge without consuming it", async () => {
    const challenge = {
      id: "expired-challenge",
      nonce: "expired-nonce",
      address: creator,
      origin: "http://localhost:5173",
      network: "kaspa_testnet_10",
      message: "Sign this message",
      expiresAt: now,
      consumedAt: null,
    };

    await store.createChallenge(challenge);

    expect(await store.consumeChallenge(challenge.id, now)).toBeNull();
    await store.pruneChallenges(now);
    expect(await store.consumeChallenge(challenge.id, now - 1)).toBeNull();
  });

  it("preserves profile visibility and creator ordering", async () => {
    const visible = {
      address: creator,
      displayName: "Visible Creator",
      isPublic: true,
      updatedAt: now,
    };
    const hidden = {
      address: "kaspatest:hidden",
      displayName: "Hidden Creator",
      isPublic: false,
      updatedAt: now,
    };

    await store.saveProfile(visible);
    await store.saveProfile(hidden);
    await store.publishPost(post("post-1", creator, now));

    expect(await store.getProfile(creator)).toEqual(visible);
    expect(await store.publicCreators(10)).toEqual([visible]);
    expect(await store.searchCreators("visible", 10)).toEqual([visible]);
    expect(await store.searchCreators("hidden", 10)).toEqual([]);
  });

  it("returns creator posts newest first and rejects duplicate media", async () => {
    const older = post("older", creator, now);
    const newer = post("newer", creator, now + 1);

    expect(await store.publishPost(older)).toBe("COMMITTED");
    expect(await store.publishPost(newer)).toBe("COMMITTED");
    expect(await store.creatorPosts(creator)).toEqual([newer, older]);
    expect(await store.publishPost({ ...newer, id: "duplicate" })).toBe(
      "MEDIA_DIGEST_CONFLICT",
    );
    expect(await store.getPost(newer.id)).toEqual(newer);
    expect(await store.findPostByMedia(creator, newer.mediaDigest)).toEqual(newer);

    const otherCreator = "kaspatest:other";
    const shared = { ...newer, id: "shared", creator: otherCreator };
    expect(await store.publishPost(shared)).toBe("COMMITTED");
    expect(await store.findPostByMedia(otherCreator, newer.mediaDigest)).toEqual(
      shared,
    );
    expect(await store.creatorPosts(otherCreator)).toEqual([shared]);
  });

  it("enforces purchase uniqueness by post, buyer, and transaction", async () => {
    const purchase = { postId: "post-1", buyer, transactionId: "tx-1" };

    expect(await store.createPurchase(purchase)).toBe("CREATED");
    expect(await store.createPurchase(purchase)).toBe("DUPLICATE");
    expect(await store.createPurchase({ ...purchase, postId: "post-2" })).toBe(
      "DUPLICATE",
    );
    expect(await store.createPurchase({ ...purchase, transactionId: "tx-2" })).toBe(
      "DUPLICATE",
    );
    expect(await store.getPurchase(purchase.postId, buyer)).toEqual(purchase);
    expect(await store.purchasesForBuyer(buyer)).toEqual([purchase]);
  });

  it("enforces one covenant per creator and unique membership receipts", async () => {
    const covenant = { creator, covenantId: "covenant-1" };
    const membership = { transactionId: "membership-1", buyer, creator };

    await store.saveCreatorCovenant(covenant);
    expect(await store.getCreatorCovenant(creator)).toEqual(covenant);
    expect(await store.saveCreatorCovenant({ creator, covenantId: "covenant-2" })).toBe(
      "DUPLICATE",
    );

    expect(await store.createMembershipPurchase(membership)).toBe("CREATED");
    expect(await store.createMembershipPurchase(membership)).toBe("DUPLICATE");
    expect(await store.membershipReceipts(buyer, creator)).toEqual([membership]);
    expect(await store.membershipReceipts(buyer, "other-creator")).toEqual([]);
  });

  it("rolls, expires, and prunes sessions", async () => {
    const session = { id: "session-1", address: buyer, expiresAt: now + 1 };

    await store.createSession(session);
    expect(await store.getSession(session.id, now)).toEqual(session);
    await store.rollSession(session.id, now + 2_000);
    expect(await store.getSession(session.id, now + 1_000)).toEqual({
      ...session,
      expiresAt: now + 2_000,
    });
    await store.pruneSessions(now + 2_000);
    expect(await store.getSession(session.id, now)).toBeNull();
  });

  it("finalizes a payment atomically with its prepared record", async () => {
    await store.savePreparedPayment({
      id: "prepared-payment",
      transaction: "{}",
      fingerprint: "fingerprint",
      amountSompi: "100000000",
      creator,
      postId: "post-1",
      buyer,
      expiresAt: now + 1_000,
    });

    expect(
      await store.finalizePurchase("prepared-payment", {
        postId: "post-1",
        buyer,
        transactionId: "tx-finalized",
      }),
    ).toBe("CREATED");
    expect(await store.getPreparedPayment("prepared-payment", now)).toBeNull();
    expect(await store.getPurchase("post-1", buyer)).toEqual({
      postId: "post-1",
      buyer,
      transactionId: "tx-finalized",
    });
  });

  it("treats repeated membership finalization as a duplicate and clears preparation", async () => {
    await store.savePreparedMembership({
      id: "prepared-membership",
      transaction: "{}",
      fingerprint: "fingerprint",
      covenantId: "covenant-1",
      signInputs: [0],
      memberOutputIndex: 1,
      creator,
      buyer,
      kind: "purchase",
      expiresAt: now + 1_000,
    });
    const membership = { transactionId: "membership-finalized", buyer, creator };

    expect(
      await store.finalizeMembershipPurchase("prepared-membership", membership),
    ).toBe("CREATED");
    expect(
      await store.finalizeMembershipPurchase("prepared-membership", membership),
    ).toBe("DUPLICATE");
    expect(await store.getPreparedMembership("prepared-membership", now)).toBeNull();
  });
});

function post(id: string, postCreator: string, publishedAt: number): Post {
  return {
    id,
    creator: postCreator,
    caption: `Caption for ${id}`,
    priceSompi: "100000000",
    mediaType: "image/jpeg",
    mediaSize: 10,
    mediaDigest: `${id}-digest`,
    mediaKey: `media/${id}`,
    publishedAt,
  };
}
