import { KaspaPaymentGateway } from "./payment-gateway.js";

describe("KaspaPaymentGateway purchase verification", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("retries a missing historical transaction before treating it as invalid", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ detail: "Transaction not found" }, { status: 404 }),
    );
    const sleep = vi.fn(async () => undefined);
    vi.stubGlobal("fetch", fetch);
    const gateway = new KaspaPaymentGateway("https://node.test", sleep);

    await expect(gateway.verifyPurchase(
      "a".repeat(64),
      "kaspatest:buyer",
      "kaspatest:creator",
      "100000000",
    )).resolves.toBe(false);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[1_000], [2_000]]);
  });

  it("recovers when the transaction appears during retry", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ detail: "Transaction not found" }, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ detail: "Transaction not found" }, { status: 404 }))
      .mockResolvedValueOnce(Response.json({
        is_accepted: true,
        inputs: [{ previous_outpoint_resolved: { script_public_key_address: "kaspatest:buyer" } }],
        outputs: [{ amount: "100000000", script_public_key_address: "kaspatest:creator" }],
      }));
    const sleep = vi.fn(async () => undefined);
    vi.stubGlobal("fetch", fetch);
    const gateway = new KaspaPaymentGateway("https://node.test", sleep);

    await expect(gateway.verifyPurchase(
      "a".repeat(64),
      "kaspatest:buyer",
      "kaspatest:creator",
      "100000000",
    )).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[1_000], [2_000]]);
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
