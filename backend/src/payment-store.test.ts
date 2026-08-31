import { LibsqlStore } from "./libsql-store.js";
import { MemoryStore } from "./memory-store.js";
import type { PaymentAttempt } from "./domain.js";

describe.each([
  ["memory", () => new MemoryStore()],
  ["libsql", () => new LibsqlStore("file::memory:")],
])("payment persistence: %s", (_name, createStore) => {
  it("compares state and atomically confirms the purchase", async () => {
    const store = createStore();
    await store.initialize();
    const attempt = paymentAttempt();
    await store.createPaymentAttempt(attempt);

    expect(
      await store.compareAndSetPaymentAttempt("attempt", "PENDING", {
        state: "REJECTED",
        updatedAt: 2,
      }),
    ).toBeNull();
    expect(
      await store.confirmPaymentAttempt("attempt", "PREPARED", {
        postId: "post",
        buyer: "buyer",
        transactionId: "transaction",
        confirmedAt: 3,
      }),
    ).toMatchObject({ state: "CONFIRMED", signedTransactionId: "transaction" });
    expect(await store.hasPurchase("post", "buyer")).toBe(true);
    expect(
      await store.confirmPaymentAttempt("attempt", "PREPARED", {
        postId: "post",
        buyer: "buyer",
        transactionId: "other",
        confirmedAt: 4,
      }),
    ).toBeNull();
  });
});

function paymentAttempt(): PaymentAttempt {
  return {
    id: "attempt",
    postId: "post",
    buyer: "buyer",
    amountSompi: "100",
    creator: "creator",
    preparedTransaction: "prepared",
    fingerprint: "fingerprint",
    signedTransactionId: null,
    state: "PREPARED",
    rejection: null,
    submittedAt: null,
    lastCheckedAt: null,
    reconciliationAttempts: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}
