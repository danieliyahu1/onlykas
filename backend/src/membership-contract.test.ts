import {
  addressPublicKey,
  decodeMembershipRedeemScript,
  MEMBERSHIP_DURATION_DAA,
  membershipMintSignatureScript,
  membershipUpdateSignatureScript,
  membershipPayload,
  parseMembershipPayloadDetails,
  membershipRedeemScript,
  type MembershipState,
} from "./membership-contract.js";
import artifact from "./contracts/membership.json" with { type: "json" };

const creator =
  "kaspatest:qrzjdw58hp75mvvx6aq58kjyg3xjk7pt0k8txpll9sxdary9npn8v3pmkukdl";
const buyer = "kaspatest:qzvp9r3gxg4wvcl44lm5phav2gz5zfx2de7qqqwd3hjlr53rtsn6wefhk0aj8";
const platformFeeAddress =
  "kaspatest:qpd82aj5unvrcj59ygscnmv9g0lryl3j5lp0dqquufqae382lh7lyxkh30lue";

describe("membership contract codec", () => {
  it("exposes minting and creator-authorized price updates", () => {
    expect(Object.keys(artifact.contracts.Membership.entries)).toEqual([
      "__covenant_entrypoint_auth_updateMembership",
      "mint",
    ]);
  });

  it("round-trips state through the compiled v2.0.0 template", () => {
    const state: MembershipState = {
      creator: addressPublicKey(creator),
      platform: addressPublicKey(platformFeeAddress),
      owner: addressPublicKey(buyer),
      expiresAtDaa: 4_000_000n,
      priceSompi: 1_000_000_000n,
      isMinter: false,
    };

    expect(decodeMembershipRedeemScript(membershipRedeemScript(state))).toEqual(state);
  });

  it("preserves the fixed-width true state encoding", () => {
    const creatorKey = addressPublicKey(creator);
    const state: MembershipState = {
      creator: creatorKey,
      platform: addressPublicKey(platformFeeAddress),
      owner: creatorKey,
      expiresAtDaa: 0n,
      priceSompi: 1_000_000_000n,
      isMinter: true,
    };
    const redeemScript = membershipRedeemScript(state);

    expect(redeemScript.length / 2).toBe(
      artifact.contracts.Membership.compiled.bytecode.length,
    );
    expect(decodeMembershipRedeemScript(redeemScript)).toEqual(state);
  });

  it("builds a mint invocation against the current minter script", () => {
    const creatorKey = addressPublicKey(creator);
    const minter: MembershipState = {
      creator: creatorKey,
      platform: addressPublicKey(platformFeeAddress),
      owner: creatorKey,
      expiresAtDaa: 0n,
      priceSompi: 1_000_000_000n,
      isMinter: true,
    };
    const member: MembershipState = {
      creator: creatorKey,
      platform: addressPublicKey(platformFeeAddress),
      owner: addressPublicKey(buyer),
      expiresAtDaa: MEMBERSHIP_DURATION_DAA,
      priceSompi: 1_000_000_000n,
      isMinter: false,
    };

    const signatureScript = membershipMintSignatureScript(
      membershipRedeemScript(minter),
      minter,
      member,
      1,
      2,
      3,
      4,
    );

    expect(signatureScript).toMatch(/^[0-9a-f]+$/);
    expect(signatureScript.endsWith(membershipRedeemScript(minter))).toBe(true);
  });

  it("builds a creator-authorized price update invocation", () => {
    const state: MembershipState = {
      creator: addressPublicKey(creator),
      platform: addressPublicKey(platformFeeAddress),
      owner: addressPublicKey(creator),
      expiresAtDaa: 0n,
      priceSompi: 1_000_000_000n,
      isMinter: true,
    };
    const signatureScript = membershipUpdateSignatureScript(
      membershipRedeemScript(state),
      2_000_000_000n,
      1,
    );

    expect(signatureScript).toMatch(/^[0-9a-f]+$/);
    expect(signatureScript.endsWith(membershipRedeemScript(state))).toBe(true);
  });

  it("publishes readable metadata alongside the member script", () => {
    const state: MembershipState = {
      creator: addressPublicKey(creator),
      platform: addressPublicKey(platformFeeAddress),
      owner: addressPublicKey(buyer),
      expiresAtDaa: 900_000n,
      priceSompi: 1_000_000_000n,
      isMinter: false,
    };
    const payload = membershipPayload(membershipRedeemScript(state), {
      platformAddress: platformFeeAddress,
      createdAtDaa: 36_000n,
      expiresAtDaa: 900_000n,
    });

    expect(parseMembershipPayloadDetails(payload)).toMatchObject({
      memberRedeemScript: membershipRedeemScript(state),
      protocol: "onlykas",
      version: 1,
      tokenType: "membership",
      metadata: {
        platformAddress: platformFeeAddress,
        membershipOutputIndex: 1,
        createdAtDaa: 36_000n,
        expiresAtDaa: 900_000n,
      },
    });
  });
});
