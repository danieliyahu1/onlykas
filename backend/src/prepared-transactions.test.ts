import { LibsqlStore } from "./libsql-store.js";
import { MemoryStore } from "./memory-store.js";
import type {
  PreparedMembershipRecord,
  PreparedPaymentRecord,
  Store,
} from "./domain.js";

const now = 1_000_000;

function payment(id: string, expiresAt: number): PreparedPaymentRecord {
  return {
    id,
    transaction: `{"id":"${id}"}`,
    fingerprint: `fp-${id}`,
    amountSompi: "100000000",
    creator: "kaspatest:creator",
    postId: `post-${id}`,
    buyer: "kaspatest:buyer",
    expiresAt,
  };
}

function membership(id: string, expiresAt: number): PreparedMembershipRecord {
  return {
    id,
    transaction: `{"id":"${id}"}`,
    fingerprint: `fp-${id}`,
    covenantId: "a".repeat(64),
    signInputs: [0, 2],
    memberOutputIndex: 1,
    creator: "kaspatest:creator",
    buyer: "kaspatest:buyer",
    kind: "purchase",
    expiresAt,
  };
}

describe.each([
  ["memory", () => new MemoryStore()],
  ["libsql", () => new LibsqlStore("file::memory:")],
])("prepared transactions: %s", (_name, createStore) => {
  it("round-trips and prunes prepared payments", async () => {
    const store: Store = createStore();
    await store.initialize();
    const live = payment("pay-live", now + 60_000);
    const expired = payment("pay-expired", now - 1);
    await store.savePreparedPayment(live);
    await store.savePreparedPayment(expired);

    expect(await store.getPreparedPayment(live.id, now)).toEqual(live);
    expect(await store.getPreparedPayment(expired.id, now)).toBeNull();

    await store.prunePreparedPayments(now);

    expect(await store.getPreparedPayment(live.id, now)).toEqual(live);
    expect(await store.getPreparedPayment(expired.id, now - 2)).toBeNull();
    await store.deletePreparedPayment(live.id);
    expect(await store.getPreparedPayment(live.id, now)).toBeNull();
  });

  it("round-trips and prunes prepared memberships", async () => {
    const store: Store = createStore();
    await store.initialize();
    const live = membership("mem-live", now + 60_000);
    const expired = membership("mem-expired", now - 1);
    const noIndex = {
      ...membership("mem-null", now + 60_000),
      memberOutputIndex: null,
    };
    await store.savePreparedMembership(live);
    await store.savePreparedMembership(expired);
    await store.savePreparedMembership(noIndex);

    expect(await store.getPreparedMembership(live.id, now)).toEqual(live);
    expect(await store.getPreparedMembership(noIndex.id, now)).toEqual(noIndex);
    expect(await store.getPreparedMembership(expired.id, now)).toBeNull();

    await store.prunePreparedMemberships(now);

    expect(await store.getPreparedMembership(live.id, now)).toEqual(live);
    expect(await store.getPreparedMembership(expired.id, now - 2)).toBeNull();
    await store.deletePreparedMembership(live.id);
    expect(await store.getPreparedMembership(live.id, now)).toBeNull();
  });
});
