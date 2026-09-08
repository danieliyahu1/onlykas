import {
  addressPublicKey,
  addressScript,
  MEMBERSHIP_INDEX_VALUE,
  MEMBERSHIP_OUTPUT_VALUE,
  MEMBERSHIP_PRICE_SOMPI,
  membershipAddress,
  membershipPayload,
  membershipRedeemScript,
  membershipScript,
  type MembershipState,
} from "./membership-contract.js";
import { KaspaMembershipVerifier } from "./verifier.js";

const creator = "kaspatest:qrzjdw58hp75mvvx6aq58kjyg3xjk7pt0k8txpll9sxdary9npn8v3pmkukdl";
const buyer = "kaspatest:qzvp9r3gxg4wvcl44lm5phav2gz5zfx2de7qqqwd3hjlr53rtsn6wefhk0aj8";
const transactionId = "11".repeat(32);
const covenantId = "22".repeat(32);

describe("KaspaMembershipVerifier", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("validates committed state, native binding, payment, ownership, unspent status, and DAA", async () => {
    const state: MembershipState = {
      creator: addressPublicKey(creator),
      owner: addressPublicKey(buyer),
      expiresAtDaa: 1_000_000n,
      isMinter: false,
    };
    const redeemScript = membershipRedeemScript(state);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/info/blockdag")) return Response.json({ virtualDaaScore: "500000" });
      if (url.includes(`/addresses/${encodeURIComponent(membershipAddress(state))}/utxos`))
        return Response.json([{ outpoint: { transactionId, index: 1 }, utxoEntry: { amount: MEMBERSHIP_OUTPUT_VALUE.toString() } }]);
      if (url.includes(`/transactions/${transactionId}`)) return Response.json({
        version: 1,
        is_accepted: true,
        payload: membershipPayload(redeemScript),
        outputs: [
          {},
          { amount: MEMBERSHIP_OUTPUT_VALUE.toString(), script_public_key: membershipScript(state).slice(4), covenant: { covenantId, authorizingInput: 0 } },
          { amount: MEMBERSHIP_PRICE_SOMPI.toString(), script_public_key: addressScript(creator).slice(4) },
          { amount: MEMBERSHIP_INDEX_VALUE.toString(), script_public_key: addressScript(buyer).slice(4) },
        ],
      });
      return new Response("not found", { status: 404 });
    }));

    const result = await new KaspaMembershipVerifier("https://node.test", () => 0).verifyUtxo(
      transactionId, 1, buyer, covenantId, creator,
    );

    expect(result.status).toBe("VALID");
    expect(result.owner).toBe(buyer);
  });
});
