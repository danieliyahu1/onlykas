import { KaspaPaymentGateway } from "./payment-gateway.js";
import { addressScript } from "./membership-contract.js";

const buyer = "kaspatest:qzvp9r3gxg4wvcl44lm5phav2gz5zfx2de7qqqwd3hjlr53rtsn6wefhk0aj8";
const creator = "kaspatest:qrzjdw58hp75mvvx6aq58kjyg3xjk7pt0k8txpll9sxdary9npn8v3pmkukdl";
const feeAddress = "kaspatest:qpd82aj5unvrcj59ygscnmv9g0lryl3j5lp0dqquufqae382lh7lyxkh30lue";

describe("KaspaPaymentGateway preparation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("puts the rounded fee beside the creator output and keeps the buyer total unchanged", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/utxos")) return Response.json([{
        outpoint: { transactionId: "11".repeat(32), index: 0 },
        utxoEntry: {
          amount: "200000000",
          scriptPublicKey: { scriptPublicKey: addressScript(buyer).slice(4) },
          blockDaaScore: "1",
          isCoinbase: false,
        },
      }]);
      if (url.endsWith("/info/fee-estimate")) return Response.json({ normalBuckets: [{ feerate: 1 }], priorityBucket: { feerate: 1 } });
      return new Response("not found", { status: 404 });
    }));
    const gateway = new KaspaPaymentGateway(feeAddress, "https://node.test", undefined, undefined, undefined);
    const prepared = await gateway.prepare({
      id: "post-1", creator, caption: "", priceSompi: "100000000", mediaType: "image/jpeg",
      mediaSize: 1, mediaDigest: "digest", mediaKey: "key", publishedAt: 0,
    }, buyer);
    const transaction = JSON.parse(prepared.transaction) as { outputs: { value: string; scriptPublicKey: string }[] };
    expect(transaction.outputs.slice(0, 2)).toEqual([
      { value: "99000000", scriptPublicKey: addressScript(creator), covenant: null },
      { value: "1000000", scriptPublicKey: addressScript(feeAddress), covenant: null },
    ]);
  });
});

describe("KaspaPaymentGateway purchase verification", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("retries a missing historical transaction before treating it as invalid", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ detail: "Transaction not found" }, { status: 404 }),
    );
    const sleep = vi.fn(async () => undefined);
    vi.stubGlobal("fetch", fetch);
    const gateway = new KaspaPaymentGateway(feeAddress, "https://node.test", sleep);

    await expect(gateway.verifyPurchase(
      "a".repeat(64),
      "kaspatest:buyer",
      "kaspatest:creator",
      "100000000",
    )).resolves.toBe(false);
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(sleep.mock.calls).toEqual([[1_000], [2_000], [4_000], [4_000]]);
  });

  it("recovers when the transaction appears during retry", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ detail: "Transaction not found" }, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ detail: "Transaction not found" }, { status: 404 }))
      .mockResolvedValueOnce(Response.json({
        is_accepted: true,
        inputs: [{ previous_outpoint_resolved: { script_public_key_address: "kaspatest:buyer" } }],
         outputs: [
           { amount: "99000000", script_public_key_address: "kaspatest:creator" },
           { amount: "1000000", script_public_key_address: "kaspatest:qpd82aj5unvrcj59ygscnmv9g0lryl3j5lp0dqquufqae382lh7lyxkh30lue" },
         ],
      }));
    const sleep = vi.fn(async () => undefined);
    vi.stubGlobal("fetch", fetch);
    const gateway = new KaspaPaymentGateway(feeAddress, "https://node.test", sleep);

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
    const gateway = new KaspaPaymentGateway(feeAddress);

    await expect(gateway.verifyPurchase(
      "a".repeat(64),
      "kaspatest:buyer",
      "kaspatest:creator",
      "100000000",
    )).rejects.toThrow("Kaspa request failed: 503 upstream unavailable");
  });
});

describe("KaspaPaymentGateway purchase confirmation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("retries a missing transaction before confirming it", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ detail: "Transaction not found" }, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ detail: "Transaction not found" }, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ is_accepted: true }));
    const sleep = vi.fn(async () => undefined);
    vi.stubGlobal("fetch", fetch);
    const gateway = new KaspaPaymentGateway(feeAddress, "https://node.test", sleep);

    await expect(gateway.status("a".repeat(64))).resolves.toEqual({
      isAccepted: true,
      transactionId: "a".repeat(64),
      rejection: null,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[1_000], [2_000]]);
  });

  it("reports pending instead of failing when the transaction is still missing", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ detail: "Transaction not found" }, { status: 404 }),
    );
    const sleep = vi.fn(async () => undefined);
    vi.stubGlobal("fetch", fetch);
    const gateway = new KaspaPaymentGateway(feeAddress, "https://node.test", sleep);

    await expect(gateway.status("a".repeat(64))).resolves.toEqual({
      isAccepted: null,
      transactionId: "a".repeat(64),
      rejection: null,
    });
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(sleep.mock.calls).toEqual([[1_000], [2_000], [4_000], [4_000]]);
  });

  it("does not hide upstream service failures during confirmation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("upstream unavailable", { status: 503 }),
    ));
    const gateway = new KaspaPaymentGateway(feeAddress);

    await expect(gateway.status("a".repeat(64))).rejects.toThrow(
      "Kaspa request failed: 503 upstream unavailable",
    );
  });
});
