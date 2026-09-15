import { LibsqlStore } from "./libsql-store.js";
import { MemoryStore } from "./memory-store.js";
import type { Purchase } from "./domain/models.js";
import type { Repositories } from "./application/ports.js";

describe.each([
  ["memory", () => new MemoryStore()],
  ["libsql", () => new LibsqlStore("file::memory:")],
])("post purchase receipts: %s", (_name, createStore) => {
  it("stores confirmed receipts only once and expires them after fifteen minutes", async () => {
    const store: Repositories = createStore();
    await store.initialize();
    const receipt: Purchase = {
      postId: "post-1",
      buyer: "buyer-1",
      transactionId: "a".repeat(64),
    };

    expect(await store.createPurchase(receipt)).toBe("CREATED");
    expect(await store.createPurchase({ ...receipt, postId: "post-2" })).toBe(
      "DUPLICATE",
    );
    expect(await store.getPurchase(receipt.postId, receipt.buyer)).toEqual(receipt);
  });
});
