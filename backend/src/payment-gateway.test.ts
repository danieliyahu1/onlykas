import { KaspaPaymentGateway } from "./payment-gateway.js";
import { addressScript } from "./membership-contract.js";

const buyer = "kaspatest:qzvp9r3gxg4wvcl44lm5phav2gz5zfx2de7qqqwd3hjlr53rtsn6wefhk0aj8";
const creator = "kaspatest:qrzjdw58hp75mvvx6aq58kjyg3xjk7pt0k8txpll9sxdary9npn8v3pmkukdl";
const feeAddress = "kaspatest:qpd82aj5unvrcj59ygscnmv9g0lryl3j5lp0dqquufqae382lh7lyxkh30lue";

describe("KaspaPaymentGateway preparation", () => {
  afterEach(() => vi.unstubAllGlobals());

  const funding = (amount: string, transactionId: string) => ({
    outpoint: { transactionId, index: 0 },
    utxoEntry: { amount, scriptPublicKey: { scriptPublicKey: addressScript(buyer).slice(4) }, blockDaaScore: "1", isCoinbase: false },
  });

  function stubNode(utxos: unknown[]) {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/utxos")) return Response.json(utxos);
      if (url.endsWith("/info/fee-estimate")) return Response.json({ normalBuckets: [{ feerate: 1 }], priorityBucket: { feerate: 1 } });
      return new Response("not found", { status: 404 });
    }));
  }

  it("sends the whole price to the creator and skips the fee below one KAS", async () => {
    stubNode([funding("200000000", "11".repeat(32))]);
    const gateway = new KaspaPaymentGateway(feeAddress, "https://node.test", undefined, undefined, undefined);
    const prepared = await gateway.prepare({
      id: "post-1", creator, caption: "", priceSompi: "100000000", mediaType: "image/jpeg",
      mediaSize: 1, mediaDigest: "digest", mediaKey: "key", publishedAt: 0,
    }, buyer);
    const transaction = JSON.parse(prepared.transaction) as { outputs: { value: string; scriptPublicKey: string }[] };
    expect(transaction.outputs[0]).toEqual({ value: "100000000", scriptPublicKey: addressScript(creator), covenant: null });
    expect(transaction.outputs.some((output) => output.scriptPublicKey === addressScript(feeAddress))).toBe(false);
  });

  it("charges the one percent fee once it reaches one KAS", async () => {
    stubNode([funding("200000000000", "33".repeat(32))]);
    const gateway = new KaspaPaymentGateway(feeAddress, "https://node.test", undefined, undefined, undefined);
    const prepared = await gateway.prepare({
      id: "post-1", creator, caption: "", priceSompi: "100000000000", mediaType: "image/jpeg",
      mediaSize: 1, mediaDigest: "digest", mediaKey: "key", publishedAt: 0,
    }, buyer);
    const transaction = JSON.parse(prepared.transaction) as { outputs: { value: string; scriptPublicKey: string }[] };
    expect(transaction.outputs[0]).toEqual({ value: "99000000000", scriptPublicKey: addressScript(creator), covenant: null });
    expect(transaction.outputs.some((output) => output.value === "1000000000" && output.scriptPublicKey === addressScript(feeAddress))).toBe(true);
  });

  it("prefers the smallest sufficient UTXO to limit transaction storage mass", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/utxos")) return Response.json([
        { outpoint: { transactionId: "11".repeat(32), index: 0 }, utxoEntry: { amount: "200000000", scriptPublicKey: { scriptPublicKey: addressScript(buyer).slice(4) }, blockDaaScore: "1", isCoinbase: false } },
        { outpoint: { transactionId: "22".repeat(32), index: 0 }, utxoEntry: { amount: "110000000", scriptPublicKey: { scriptPublicKey: addressScript(buyer).slice(4) }, blockDaaScore: "1", isCoinbase: false } },
      ]);
      if (url.endsWith("/info/fee-estimate")) return Response.json({ normalBuckets: [{ feerate: 1 }], priorityBucket: { feerate: 1 } });
      return new Response("not found", { status: 404 });
    }));
    const gateway = new KaspaPaymentGateway(feeAddress, "https://node.test", undefined, undefined, undefined);
    const prepared = await gateway.prepare({ id: "post-1", creator, caption: "", priceSompi: "100000000", mediaType: "image/jpeg", mediaSize: 1, mediaDigest: "digest", mediaKey: "key", publishedAt: 0 }, buyer);
    const transaction = JSON.parse(prepared.transaction) as { inputs: { transactionId: string }[] };
    expect(transaction.inputs).toHaveLength(1);
    expect(transaction.inputs[0]!.transactionId).toBe("22".repeat(32));
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
           { amount: "100000000", script_public_key_address: "kaspatest:creator" },
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

  it("rejects a purchase that omits the platform fee once it is due", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      is_accepted: true,
      inputs: [{ previous_outpoint_resolved: { script_public_key_address: "kaspatest:buyer" } }],
      outputs: [
        { amount: "100000000000", script_public_key_address: "kaspatest:creator" },
      ],
    })));
    const gateway = new KaspaPaymentGateway(feeAddress);

    await expect(gateway.verifyPurchase(
      "a".repeat(64),
      "kaspatest:buyer",
      "kaspatest:creator",
      "100000000000",
    )).resolves.toBe(false);
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
