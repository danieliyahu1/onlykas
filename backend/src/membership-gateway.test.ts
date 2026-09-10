import { Transaction } from "@kluster/kaspa-wasm";
import {
  KaspaMembershipGateway,
  submitMembershipTransactionOverWrpc,
} from "./membership-gateway.js";
import {
  addressPublicKey,
  addressScript,
  MEMBERSHIP_OUTPUT_VALUE,
  membershipAddress,
  membershipScript,
  type MembershipState,
} from "./membership-contract.js";

const creator = "kaspatest:qrzjdw58hp75mvvx6aq58kjyg3xjk7pt0k8txpll9sxdary9npn8v3pmkukdl";
const buyer = "kaspatest:qzvp9r3gxg4wvcl44lm5phav2gz5zfx2de7qqqwd3hjlr53rtsn6wefhk0aj8";
const creatorKey = addressPublicKey(creator);
const minter: MembershipState = { creator: creatorKey, owner: creatorKey, expiresAtDaa: 0n, isMinter: true };

describe("KaspaMembershipGateway", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("builds SDK-readable genesis and mint transactions", async () => {
    const funding = (address: string, id: string, amount: string, script = addressScript(address).slice(4)) => ({
      outpoint: { transactionId: id, index: 0 },
      utxoEntry: {
        amount,
        scriptPublicKey: { scriptPublicKey: script },
        blockDaaScore: "100",
        isCoinbase: false,
      },
    });
    let offerCovenantId = "";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/info/fee-estimate"))
        return Response.json({ normalBuckets: [{ feerate: 1 }], priorityBucket: { feerate: 1 } });
      if (url.includes("/info/blockdag")) return Response.json({ virtualDaaScore: "500000" });
      if (url.includes(encodeURIComponent(membershipAddress(minter))))
        return Response.json([
          funding(creator, "44".repeat(32), MEMBERSHIP_OUTPUT_VALUE.toString(), membershipScript(minter).slice(4)),
          funding(creator, "33".repeat(32), MEMBERSHIP_OUTPUT_VALUE.toString(), membershipScript(minter).slice(4)),
        ]);
      if (url.endsWith(`/transactions/${"44".repeat(32)}`))
        return Response.json({
          version: 1,
          is_accepted: true,
          outputs: [{
            amount: MEMBERSHIP_OUTPUT_VALUE.toString(),
            script_public_key: membershipScript(minter).slice(4),
            covenant_authorizing_input: 0,
            covenant_id: "55".repeat(32),
          }],
        });
      if (url.endsWith(`/transactions/${"33".repeat(32)}`))
        return Response.json({
          version: 1,
          is_accepted: true,
          outputs: [{
            amount: MEMBERSHIP_OUTPUT_VALUE.toString(),
            script_public_key: membershipScript(minter).slice(4),
            covenant_authorizing_input: 0,
            covenant_id: offerCovenantId,
          }],
        });
      if (url.includes(encodeURIComponent(creator)))
        return Response.json([funding(creator, "11".repeat(32), "100000000")]);
      if (url.includes(encodeURIComponent(buyer)))
        return Response.json([funding(buyer, "22".repeat(32), "6000000000")]);
      return new Response("not found", { status: 404 });
    }));
    const gateway = new KaspaMembershipGateway("https://node.test");

    const offer = await gateway.prepareOffer(creator);
    offerCovenantId = offer.covenantId;
    const offerTransaction = Transaction.deserializeFromSafeJSON(offer.transaction);
    expect(offerTransaction.version).toBe(1);
    expect(offerTransaction.outputs[0]?.covenant?.covenantId.toString()).toBe(offer.covenantId);

    const mint = await gateway.prepareMint(creator, buyer, offer.covenantId);
    const mintTransaction = Transaction.deserializeFromSafeJSON(mint.transaction);
    expect(mint.signInputs).toEqual([1]);
    expect(mintTransaction.lockTime).toBe(500_000n);
    expect(mintTransaction.inputs[0]?.previousOutpoint.transactionId).toBe("33".repeat(32));
    expect(mintTransaction.inputs[0]?.signatureScript).toBeTruthy();
    expect(mintTransaction.outputs[1]?.covenant?.covenantId.toString()).toBe(offer.covenantId);
    const inputValue = mintTransaction.inputs.reduce((sum, input) => sum + (input.utxo?.amount ?? 0n), 0n);
    const outputValue = mintTransaction.outputs.reduce((sum, output) => sum + output.value, 0n);
    expect(inputValue - outputValue).toBe(1_490_700n);
  });

  it("prices fees from version 1 compute mass", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/info/fee-estimate"))
        return Response.json({ normalBuckets: [{ feerate: 100 }], priorityBucket: { feerate: 100 } });
      if (url.includes(encodeURIComponent(creator)))
        return Response.json([{
          outpoint: { transactionId: "11".repeat(32), index: 0 },
          utxoEntry: {
            amount: "100000000",
            scriptPublicKey: { scriptPublicKey: addressScript(creator).slice(4) },
            blockDaaScore: "100",
            isCoinbase: false,
          },
        }]);
      return new Response("not found", { status: 404 });
    }));
    const gateway = new KaspaMembershipGateway("https://node.test");

    const offer = await gateway.prepareOffer(creator);
    const transaction = Transaction.deserializeFromSafeJSON(offer.transaction);
    const inputValue = transaction.inputs.reduce((sum, input) => sum + (input.utxo?.amount ?? 0n), 0n);
    const outputValue = transaction.outputs.reduce((sum, output) => sum + output.value, 0n);

    expect(inputValue - outputValue).toBe(608_300n);
  });

  it("submits version 1 inputs using compute budgets", async () => {
    const transactionId = "44".repeat(32);
    const relay = vi.fn(async () => transactionId);
    const sleep = vi.fn(async () => undefined);
    let confirmationAttempts = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/info/fee-estimate"))
        return Response.json({ normalBuckets: [{ feerate: 1 }], priorityBucket: { feerate: 1 } });
      if (url.includes(encodeURIComponent(creator)))
        return Response.json([{
          outpoint: { transactionId: "11".repeat(32), index: 0 },
          utxoEntry: {
            amount: "100000000",
            scriptPublicKey: { scriptPublicKey: addressScript(creator).slice(4) },
            blockDaaScore: "100",
            isCoinbase: false,
          },
        }]);
      if (url.endsWith("/transactions") && init?.method === "POST")
        return Response.json({ error: "covenant transactions must use wRPC" }, { status: 400 });
      if (url.endsWith(`/transactions/${transactionId}`)) {
        confirmationAttempts += 1;
        if (confirmationAttempts < 3) return Response.json({ detail: "Transaction not found" }, { status: 404 });
        return Response.json({ is_accepted: true });
      }
      return new Response("not found", { status: 404 });
    }));
    const gateway = new KaspaMembershipGateway("https://node.test", relay, sleep);
    const offer = await gateway.prepareOffer(creator);
    const signed = JSON.parse(offer.transaction) as { inputs: { signatureScript: string }[] };
    signed.inputs[0]!.signatureScript = "aa01";
    const signedJson = JSON.stringify(signed);

    await expect(gateway.submit(offer, signedJson)).resolves.toMatchObject({
      isAccepted: true,
      transactionId,
    });
    expect(relay).toHaveBeenCalledWith(signedJson);
    expect(confirmationAttempts).toBe(3);
    expect(sleep.mock.calls).toEqual([[1_000], [2_000]]);
  });

  it("relays signed covenant transactions over wRPC", async () => {
    const transactionId = "44".repeat(32);
    const connect = vi.fn(async () => undefined);
    const disconnect = vi.fn(async () => undefined);
    const submitTransaction = vi.fn(async (request: { transaction: unknown; allowOrphan?: boolean }) => {
      void request;
      return { transactionId };
    });
    const input = {
      transactionId: "11".repeat(32), index: 0, sequence: "0", sigOpCount: 0,
      computeBudget: 50, signatureScript: "aa01",
      utxo: { address: null, amount: "30000000", scriptPublicKey: addressScript(creator), blockDaaScore: "100", isCoinbase: false, covenantId: null },
    };
    const covenantId = "33".repeat(32);
    const signed = JSON.stringify({
      id: "0".repeat(64), version: 1, inputs: [input],
      outputs: [{ value: MEMBERSHIP_OUTPUT_VALUE.toString(), scriptPublicKey: addressScript(creator), covenant: { authorizingInput: 0, covenantId } }],
      subnetworkId: "0".repeat(40), lockTime: "0", gas: "0", storageMass: "20000", payload: "",
    });

    await expect(submitMembershipTransactionOverWrpc(signed, () => ({ connect, disconnect, submitTransaction }))).resolves.toBe(transactionId);

    expect(connect).toHaveBeenCalledWith({ timeoutDuration: 10_000, retryInterval: 1_000 });
    expect(submitTransaction).toHaveBeenCalledWith({
      transaction: expect.objectContaining({ version: 1 }),
      allowOrphan: false,
    });
    const transaction = submitTransaction.mock.calls[0]![0].transaction as Transaction;
    expect(transaction.inputs[0]).toMatchObject({ sigOpCount: 0, computeBudget: 50 });
    expect(transaction.outputs[0]?.covenant?.covenantId.toString()).toBe(covenantId);
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
