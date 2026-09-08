import { Transaction } from "@kluster/kaspa-wasm";
import { KaspaMembershipGateway } from "./membership-gateway.js";
import {
  addressPublicKey,
  addressScript,
  MEMBERSHIP_OUTPUT_VALUE,
  membershipAddress,
  type MembershipState,
} from "./membership-contract.js";

const creator = "kaspatest:qrzjdw58hp75mvvx6aq58kjyg3xjk7pt0k8txpll9sxdary9npn8v3pmkukdl";
const buyer = "kaspatest:qzvp9r3gxg4wvcl44lm5phav2gz5zfx2de7qqqwd3hjlr53rtsn6wefhk0aj8";
const creatorKey = addressPublicKey(creator);
const minter: MembershipState = { creator: creatorKey, owner: creatorKey, expiresAtDaa: 0n, isMinter: true };

describe("KaspaMembershipGateway", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("builds SDK-readable genesis and mint transactions", async () => {
    const funding = (address: string, id: string, amount: string, covenantId?: string) => ({
      outpoint: { transactionId: id, index: 0 },
      utxoEntry: {
        amount,
        scriptPublicKey: { scriptPublicKey: addressScript(address).slice(4) },
        blockDaaScore: "100",
        isCoinbase: false,
        ...(covenantId ? { covenantId } : {}),
      },
    });
    let offerCovenantId = "";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/info/fee-estimate"))
        return Response.json({ normalBuckets: [{ feerate: 1 }], priorityBucket: { feerate: 1 } });
      if (url.includes("/info/blockdag")) return Response.json({ virtualDaaScore: "500000" });
      if (url.includes(encodeURIComponent(membershipAddress(minter))))
        return Response.json([funding(creator, "33".repeat(32), MEMBERSHIP_OUTPUT_VALUE.toString(), offerCovenantId)]);
      if (url.includes(encodeURIComponent(creator)))
        return Response.json([funding(creator, "11".repeat(32), "30000000")]);
      if (url.includes(encodeURIComponent(buyer)))
        return Response.json([funding(buyer, "22".repeat(32), "200000000")]);
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
    expect(mintTransaction.inputs[0]?.signatureScript).toBeTruthy();
    expect(mintTransaction.outputs[1]?.covenant?.covenantId.toString()).toBe(offer.covenantId);
    const inputValue = mintTransaction.inputs.reduce((sum, input) => sum + (input.utxo?.amount ?? 0n), 0n);
    const outputValue = mintTransaction.outputs.reduce((sum, output) => sum + output.value, 0n);
    expect(inputValue).toBeGreaterThan(outputValue);
  });
});
