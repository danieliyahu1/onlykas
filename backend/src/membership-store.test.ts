import { LibsqlStore } from "./libsql-store.js";
import { MemoryStore } from "./memory-store.js";
import type {
  Membership,
  MembershipCovenant,
  MembershipMintAttempt,
  MembershipOffer,
  MembershipTransferAttempt,
  Store,
} from "./domain.js";

describe.each([
  ["memory", () => new MemoryStore()],
  ["libsql", () => new LibsqlStore("file::memory:")],
])("membership persistence: %s", (_name, createStore) => {
  let store: Store;

  beforeEach(async () => {
    store = createStore();
    await store.initialize();
    await store.saveCovenant(testCovenant());
  });

  it("round-trips a covenant through save/get", async () => {
    const covenant = testCovenant();
    await store.saveCovenant(covenant);
    expect(await store.getCovenant(covenant.id)).toEqual(covenant);
  });

  it("saveCovenant is idempotent (INSERT OR IGNORE)", async () => {
    const covenant = testCovenant();
    await store.saveCovenant(covenant);
    await store.saveCovenant(covenant);
    expect(await store.getCovenant(covenant.id)).toEqual(covenant);
  });

  it("returns null for missing covenant", async () => {
    expect(await store.getCovenant("nonexistent")).toBeNull();
  });

  it("round-trips a membership offer", async () => {
    const offer = testOffer();
    await store.createMembershipOffer(offer);
    expect(await store.getMembershipOffer(offer.id)).toEqual(offer);
  });

  it("lists creator membership offers", async () => {
    const offer = testOffer();
    await store.createMembershipOffer(offer);
    const offers = await store.creatorMembershipOffers("creator");
    expect(offers).toHaveLength(1);
    expect(offers[0]!.id).toBe(offer.id);
  });

  it("round-trips a membership", async () => {
    await seedOffer(store);
    const membership = testMembership();
    await store.createMembership(membership);
    expect(await store.getMembership(membership.id)).toEqual(membership);
  });

  it("lists owner memberships excluding transferred", async () => {
    await seedOffer(store);
    const membership = testMembership();
    await store.createMembership(membership);
    const list = await store.ownerMemberships("seller");
    expect(list).toHaveLength(1);
    const transferred = testMembership({
      id: "mem-2",
      state: "TRANSFERRED",
    });
    await store.createMembership(transferred);
    const listAfter = await store.ownerMemberships("seller");
    expect(listAfter).toHaveLength(1);
  });

  it("creates and retrieves membership transfer attempts", async () => {
    await seedMembership(store);
    const attempt = testTransferAttempt();
    await store.createMembershipTransferAttempt(attempt);
    expect(await store.getMembershipTransferAttempt(attempt.id)).toEqual(
      attempt,
    );
  });

  it("compareAndSet rejects wrong state", async () => {
    await seedMembership(store);
    const attempt = testTransferAttempt();
    await store.createMembershipTransferAttempt(attempt);
    expect(
      await store.compareAndSetMembershipTransferAttempt(
        attempt.id,
        "CONFIRMED",
        { state: "REJECTED", updatedAt: 2 },
      ),
    ).toBeNull();
  });

  it("confirms a transfer attempt and transfers membership ownership", async () => {
    await seedOffer(store);
    const membership = testMembership();
    await store.createMembership(membership);
    const attempt = testTransferAttempt({
      membershipId: membership.id,
      state: "PREPARED",
    });
    await store.createMembershipTransferAttempt(attempt);
    const confirmed = await store.confirmMembershipTransferAttempt(
      attempt.id,
      "PREPARED",
      { transactionId: "tx-confirmed", confirmedAt: 999 },
    );
    expect(confirmed).toMatchObject({
      state: "CONFIRMED",
      signedTransactionId: "tx-confirmed",
    });
    const updatedMembership = await store.getMembership(membership.id);
    expect(updatedMembership!.owner).toBe(attempt.buyer);
    expect(updatedMembership!.state).toBe("ACTIVE");
    expect(updatedMembership!.validUntil).toBe(membership.validUntil);
  });

  it("pendingMembershipTransferAttempts returns only PENDING", async () => {
    await seedMembership(store);
    await store.createMembershipTransferAttempt(
      testTransferAttempt({ id: "a", state: "PENDING" }),
    );
    await store.createMembershipTransferAttempt(
      testTransferAttempt({ id: "b", state: "CONFIRMED" }),
    );
    const pending = await store.pendingMembershipTransferAttempts();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.id).toBe("a");
  });

  it("round-trips a membership mint attempt", async () => {
    await seedOffer(store);
    const attempt = testMintAttempt();
    await store.createMembershipMintAttempt(attempt);
    expect(await store.getMembershipMintAttempt(attempt.id)).toEqual(attempt);
    expect(
      (await store.unresolvedMembershipMintAttempt("offer-test", "buyer"))?.id,
    ).toBe(attempt.id);
  });

  it("allows a renewal once the previous attempt is resolved", async () => {
    await seedOffer(store);
    const first = testMintAttempt({ id: "mint-1" });
    await store.createMembershipMintAttempt(first);
    expect(
      await store.unresolvedMembershipMintAttempt("offer-test", "buyer"),
    ).toMatchObject({ id: "mint-1" });
    await store.compareAndSetMembershipMintAttempt(first.id, "PREPARED", {
      state: "REJECTED",
      rejection: "STALE_PREPARATION",
      updatedAt: 2,
    });
    expect(
      await store.unresolvedMembershipMintAttempt("offer-test", "buyer"),
    ).toBeNull();
    const second = testMintAttempt({ id: "mint-2" });
    await store.createMembershipMintAttempt(second);
    expect(
      (await store.unresolvedMembershipMintAttempt("offer-test", "buyer"))?.id,
    ).toBe("mint-2");
  });

  it("does not create an overlapping open mint for the same offer and buyer", async () => {
    await seedOffer(store);
    const first = testMintAttempt({ id: "mint-1" });
    await store.createMembershipMintAttempt(first);
    await store.createMembershipMintAttempt(testMintAttempt({ id: "mint-2" }));
    const open = await store.unresolvedMembershipMintAttempt(
      "offer-test",
      "buyer",
    );
    expect(open!.id).toBe("mint-1");
  });

  it("pendingMembershipMintAttempts returns only PENDING", async () => {
    await seedOffer(store);
    await store.createMembershipMintAttempt(
      testMintAttempt({ id: "a", state: "PENDING" }),
    );
    await store.createMembershipMintAttempt(
      testMintAttempt({ id: "b", state: "PREPARED" }),
    );
    await store.createMembershipMintAttempt(
      testMintAttempt({ id: "c", state: "CONFIRMED" }),
    );
    const pending = await store.pendingMembershipMintAttempts();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.id).toBe("a");
  });

  it("compareAndSet on a mint attempt rejects a wrong expected state", async () => {
    await seedOffer(store);
    const attempt = testMintAttempt();
    await store.createMembershipMintAttempt(attempt);
    expect(
      await store.compareAndSetMembershipMintAttempt(attempt.id, "PENDING", {
        state: "REJECTED",
        updatedAt: 2,
      }),
    ).toBeNull();
  });

  it("confirming a mint attempt records the membership without extending an existing one", async () => {
    await seedOffer(store);
    const prior = testMembership({
      id: "mem-prior",
      owner: "buyer",
      validUntil: 5000,
    });
    await store.createMembership(prior);
    const attempt = testMintAttempt({
      id: "mint-1",
      signedTransactionId: "tx-mint",
      state: "PREPARED",
    });
    await store.createMembershipMintAttempt(attempt);
    const membership = testMembership({
      id: "mint-1",
      offerId: "offer-test",
      owner: "buyer",
      creator: "creator",
      covenantId: "covenant-test",
      createdTxId: "tx-mint",
      validUntil: 1000 + 86400_000,
      createdAt: 1000,
    });
    const confirmed = await store.confirmMembershipMintAttempt(
      "mint-1",
      "PREPARED",
      membership,
    );
    expect(confirmed).toMatchObject({
      state: "CONFIRMED",
      signedTransactionId: "tx-mint",
    });
    const minted = await store.getMembership("mint-1");
    expect(minted).toMatchObject({
      owner: "buyer",
      creator: "creator",
      validUntil: 1000 + 86400_000,
      state: "ACTIVE",
    });
    const stillPrior = await store.getMembership("mem-prior");
    expect(stillPrior!.validUntil).toBe(5000);
  });

  it("confirming a mint attempt skips a membership mismatch", async () => {
    await seedOffer(store);
    const attempt = testMintAttempt({ id: "mint-1" });
    await store.createMembershipMintAttempt(attempt);
    const mismatch = testMembership({
      id: "mint-1",
      owner: "someone-else",
    });
    expect(
      await store.confirmMembershipMintAttempt("mint-1", "PREPARED", mismatch),
    ).toBeNull();
    expect((await store.getMembershipMintAttempt("mint-1"))?.state).toBe(
      "PREPARED",
    );
  });

  it("offerMemberships lists the owner's memberships newest first", async () => {
    await seedOffer(store);
    await store.createMembershipMintAttempt(
      testMintAttempt({ id: "mint-1", state: "CONFIRMED" }),
    );
    await store.createMembershipMintAttempt(
      testMintAttempt({ id: "mint-2", state: "CONFIRMED" }),
    );
    await store.confirmMembershipMintAttempt(
      "mint-1",
      "CONFIRMED",
      testMembership({
        id: "mint-1",
        owner: "buyer",
        createdAt: 1000,
        validUntil: 5000,
      }),
    );
    await store.confirmMembershipMintAttempt(
      "mint-2",
      "CONFIRMED",
      testMembership({
        id: "mint-2",
        owner: "buyer",
        createdAt: 2000,
        validUntil: 6000,
      }),
    );
    const list = await store.offerMemberships("offer-test", "buyer");
    expect(list.map((membership) => membership.id)).toEqual([
      "mint-2",
      "mint-1",
    ]);
  });

  it("expireMemberships transitions only ACTIVE memberships past their window", async () => {
    await seedOffer(store);
    await store.createMembership(testMembership({ validUntil: 500 }));
    await store.createMembership(
      testMembership({ id: "mem-2", validUntil: 9000 }),
    );
    expect(await store.expireMemberships(1000)).toBe(1);
    expect((await store.getMembership("mem-test"))?.state).toBe("EXPIRED");
    expect((await store.getMembership("mem-2"))?.state).toBe("ACTIVE");
  });
});

async function seedOffer(store: Store): Promise<void> {
  await store.createMembershipOffer(testOffer());
}

async function seedMembership(store: Store): Promise<Membership> {
  await seedOffer(store);
  const membership = testMembership();
  await store.createMembership(membership);
  return membership;
}

function testCovenant(): MembershipCovenant {
  return {
    id: "covenant-test",
    templateJson: '{"type":"KCC-0020","amount":1}',
    templateFingerprint: "a".repeat(64),
    amount: "1",
    durationMs: 86400_000,
    creatorRoyaltyBps: 1000,
    createdAt: 1,
  };
}

function testOffer(): MembershipOffer {
  return {
    id: "offer-test",
    creator: "creator",
    covenantId: "covenant-test",
    priceSompi: "100",
    description: "Test membership",
    isActive: true,
    createdAt: 1,
    updatedAt: 1,
  };
}

function testMembership(overrides: Partial<Membership> = {}): Membership {
  return {
    id: "mem-test",
    offerId: "offer-test",
    owner: "seller",
    creator: "creator",
    covenantId: "covenant-test",
    createdTxId: "tx-1",
    validUntil: 2000,
    state: "ACTIVE",
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function testTransferAttempt(
  overrides: Partial<MembershipTransferAttempt> = {},
): MembershipTransferAttempt {
  return {
    id: "attempt-test",
    membershipId: "mem-test",
    seller: "seller",
    buyer: "buyer",
    saleAmountSompi: "1000",
    creatorRoyaltySompi: "100",
    creatorPayoutAddress: "creator",
    preparedTransaction: "{}",
    fingerprint: "fingerprint",
    signedTransactionId: null,
    state: "PREPARED",
    rejection: null,
    submittedAt: null,
    lastCheckedAt: null,
    reconciliationAttempts: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function testMintAttempt(
  overrides: Partial<MembershipMintAttempt> = {},
): MembershipMintAttempt {
  return {
    id: "mint-test",
    offerId: "offer-test",
    buyer: "buyer",
    creator: "creator",
    covenantId: "covenant-test",
    priceSompi: "100",
    preparedTransaction: "{}",
    fingerprint: "fingerprint",
    signedTransactionId: null,
    state: "PREPARED",
    rejection: null,
    submittedAt: null,
    lastCheckedAt: null,
    reconciliationAttempts: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}
