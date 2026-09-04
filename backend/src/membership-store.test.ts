import { LibsqlStore } from "./libsql-store.js";
import { MemoryStore } from "./memory-store.js";
import type {
  Membership,
  MembershipCovenant,
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

  it("confirms a transfer attempt and marks membership as transferred", async () => {
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
    expect(updatedMembership!.state).toBe("TRANSFERRED");
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

function testMembership(
  overrides: Partial<Membership> = {},
): Membership {
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
