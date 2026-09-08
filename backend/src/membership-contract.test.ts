import {
  addressPublicKey,
  decodeMembershipRedeemScript,
  MEMBERSHIP_DURATION_DAA,
  membershipMintSignatureScript,
  membershipRedeemScript,
  type MembershipState,
} from "./membership-contract.js";
import artifact from "./contracts/membership.json" with { type: "json" };

const creator = "kaspatest:qrzjdw58hp75mvvx6aq58kjyg3xjk7pt0k8txpll9sxdary9npn8v3pmkukdl";
const buyer = "kaspatest:qzvp9r3gxg4wvcl44lm5phav2gz5zfx2de7qqqwd3hjlr53rtsn6wefhk0aj8";

describe("membership contract codec", () => {
  it("exposes minting but no transfer entrypoint", () => {
    expect(Object.keys(artifact.contracts.Membership.entries)).toEqual(["mint"]);
  });

  it("round-trips state through the compiled RC-1 template", () => {
    const state: MembershipState = {
      creator: addressPublicKey(creator),
      owner: addressPublicKey(buyer),
      expiresAtDaa: 4_000_000n,
      isMinter: false,
    };

    expect(decodeMembershipRedeemScript(membershipRedeemScript(state))).toEqual(state);
  });

  it("builds a mint invocation against the current minter script", () => {
    const creatorKey = addressPublicKey(creator);
    const minter: MembershipState = { creator: creatorKey, owner: creatorKey, expiresAtDaa: 0n, isMinter: true };
    const member: MembershipState = {
      creator: creatorKey,
      owner: addressPublicKey(buyer),
      expiresAtDaa: MEMBERSHIP_DURATION_DAA,
      isMinter: false,
    };

    const signatureScript = membershipMintSignatureScript(
      membershipRedeemScript(minter), minter, member, 1, 2, 3,
    );

    expect(signatureScript).toMatch(/^[0-9a-f]+$/);
    expect(signatureScript.endsWith(membershipRedeemScript(minter))).toBe(true);
  });
});
