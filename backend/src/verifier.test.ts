import {
  addressPublicKey,
  addressScript,
  MEMBERSHIP_CREATOR_SHARE,
  MEMBERSHIP_INDEX_VALUE,
  MEMBERSHIP_OUTPUT_VALUE,
  MEMBERSHIP_PLATFORM_SHARE,
  membershipAddress,
  membershipPayload,
  membershipRedeemScript,
  membershipScript,
  type MembershipState,
} from "./membership-contract.js";
import { KaspaMembershipVerifier } from "./verifier.js";

const creator = "kaspatest:qrzjdw58hp75mvvx6aq58kjyg3xjk7pt0k8txpll9sxdary9npn8v3pmkukdl";
const buyer = "kaspatest:qzvp9r3gxg4wvcl44lm5phav2gz5zfx2de7qqqwd3hjlr53rtsn6wefhk0aj8";
const platformFeeAddress = "kaspatest:qpd82aj5unvrcj59ygscnmv9g0lryl3j5lp0dqquufqae382lh7lyxkh30lue";
const transactionId = "11".repeat(32);
const covenantId = "22".repeat(32);

describe("KaspaMembershipVerifier", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("validates committed state, native binding, payment, ownership, unspent status, and DAA", async () => {
    const state: MembershipState = {
      creator: addressPublicKey(creator),
      platform: addressPublicKey(platformFeeAddress),
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
        payload: membershipPayload(redeemScript, {
          platformName: "OnlyKas",
          platformAddress: platformFeeAddress,
          createdAtDaa: 136_000n,
          expiresAtDaa: 1_000_000n,
        }),
        outputs: [
          {},
          { amount: MEMBERSHIP_OUTPUT_VALUE.toString(), script_public_key: membershipScript(state).slice(4), covenant: { covenantId, authorizingInput: 0 } },
          { amount: MEMBERSHIP_CREATOR_SHARE.toString(), script_public_key: addressScript(creator).slice(4) },
          { amount: MEMBERSHIP_PLATFORM_SHARE.toString(), script_public_key: addressScript(platformFeeAddress).slice(4) },
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
    expect(result.contentCreator).toBe(creator);
    expect(result.platformName).toBe("OnlyKas");
    expect(result.platformAddress).toBe(platformFeeAddress);
    expect(result.createdAtDaa).toBe("136000");
    expect(result.expiresAtDaa).toBe("1000000");
  });

  it("rejects metadata that does not describe the protected platform", async () => {
    const state: MembershipState = {
      creator: addressPublicKey(creator),
      platform: addressPublicKey(platformFeeAddress),
      owner: addressPublicKey(buyer),
      expiresAtDaa: 1_000_000n,
      isMinter: false,
    };
    const redeemScript = membershipRedeemScript(state);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/info/blockdag")) return Response.json({ virtualDaaScore: "500000" });
      if (url.includes(`/transactions/${transactionId}`)) return Response.json({
        version: 1,
        is_accepted: true,
        payload: membershipPayload(redeemScript, {
          platformName: "OnlyKas",
          platformAddress: creator,
          createdAtDaa: 136_000n,
          expiresAtDaa: 1_000_000n,
        }),
        outputs: [{}, { amount: MEMBERSHIP_OUTPUT_VALUE.toString(), script_public_key: membershipScript(state).slice(4), covenant: { covenantId, authorizingInput: 0 } }],
      });
      return new Response("not found", { status: 404 });
    }));

    const result = await new KaspaMembershipVerifier("https://node.test", () => 0).verifyUtxo(transactionId, 1);

    expect(result.status).toBe("NOT_MEMBERSHIP");
  });
});
