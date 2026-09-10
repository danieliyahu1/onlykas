import { KaspaPaymentGateway } from "./payment-gateway.js";

describe("KaspaPaymentGateway purchase verification", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("treats a missing historical transaction as an invalid purchase", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      Response.json({ detail: "Transaction not found" }, { status: 404 }),
    ));
    const gateway = new KaspaPaymentGateway();

    await expect(gateway.verifyPurchase(
      "a".repeat(64),
      "kaspatest:buyer",
      "kaspatest:creator",
      "100000000",
    )).resolves.toBe(false);
  });

  it("does not hide upstream service failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("upstream unavailable", { status: 503 }),
    ));
    const gateway = new KaspaPaymentGateway();

    await expect(gateway.verifyPurchase(
      "a".repeat(64),
      "kaspatest:buyer",
      "kaspatest:creator",
      "100000000",
    )).rejects.toThrow("Kaspa request failed: 503 upstream unavailable");
  });
});
