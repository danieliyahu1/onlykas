import {
  addressPublicKey,
  membershipAddress,
  MEMBERSHIP_INDEX_VALUE,
  MEMBERSHIP_OUTPUT_VALUE,
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

function memberState(overrides: Partial<MembershipState> = {}): MembershipState {
  return {
    creator: addressPublicKey(creator),
    platform: addressPublicKey(platformFeeAddress),
    owner: addressPublicKey(buyer),
    expiresAtDaa: 1_000_000n,
    isMinter: false,
    ...overrides,
  };
}

type StubOptions = {
  state: MembershipState;
  payload?: string;
  outputs?: unknown[];
  utxoAmount?: string | null;
  utxo?: boolean;
  daa?: string;
};

function stubChain(options: StubOptions) {
  const { state } = options;
  const redeemScript = membershipRedeemScript(state);
  const payload =
    options.payload ??
    membershipPayload(redeemScript, {
      platformAddress: platformFeeAddress,
      createdAtDaa: 136_000n,
      expiresAtDaa: state.expiresAtDaa,
    });
  const outputs = options.outputs ?? [
    {},
    {
      amount: MEMBERSHIP_OUTPUT_VALUE.toString(),
      script_public_key: membershipScript(state).slice(4),
      covenant: { covenantId, authorizingInput: 0 },
    },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/info/blockdag"))
        return Response.json({ virtualDaaScore: options.daa ?? "500000" });
      if (url.includes(`/addresses/${encodeURIComponent(membershipAddress(state))}/utxos`))
        return Response.json(
          options.utxo === false
            ? []
            : [
                {
                  outpoint: { transactionId, index: 1 },
                  utxoEntry: { amount: options.utxoAmount ?? MEMBERSHIP_OUTPUT_VALUE.toString() },
                },
              ],
        );
      if (url.includes(`/transactions/${transactionId}`))
        return Response.json({ version: 1, is_accepted: true, payload, outputs });
      return new Response("not found", { status: 404 });
    }),
  );
}

describe("KaspaMembershipVerifier", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("validates covenant state, ownership, unspent status, and DAA", async () => {
    const state = memberState();
    stubChain({ state });

    const result = await new KaspaMembershipVerifier("https://node.test", () => 0).verifyUtxo(
      transactionId,
      1,
      buyer,
      covenantId,
      creator,
    );

    expect(result.status).toBe("VALID");
    expect(result.owner).toBe(buyer);
    expect(result.contentCreator).toBe(creator);
    expect(result.platformAddress).toBe(platformFeeAddress);
    expect(result.createdAtDaa).toBe("136000");
    expect(result.expiresAtDaa).toBe("1000000");
  });

  it("trusts the contract and accepts memberships with other amounts and metadata", async () => {
    const state = memberState();
    const redeemScript = membershipRedeemScript(state);
    stubChain({
      state,
      payload: membershipPayload(redeemScript, {
        platformAddress: creator,
        createdAtDaa: 136_000n,
        expiresAtDaa: 9_999_999n,
      }),
      outputs: [
        {},
        {
          amount: "1",
          script_public_key: membershipScript(state).slice(4),
          covenant: { covenantId, authorizingInput: 0 },
        },
      ],
    });

    const result = await new KaspaMembershipVerifier("https://node.test", () => 0).verifyUtxo(
      transactionId,
      1,
      buyer,
      covenantId,
      creator,
    );

    expect(result.status).toBe("VALID");
    expect(result.platformAddress).toBe(platformFeeAddress);
    expect(result.expiresAtDaa).toBe("1000000");
  });

  it("reports a covenant whose owner differs from the expected address", async () => {
    const state = memberState({ owner: addressPublicKey(creator) });
    stubChain({ state });

    const result = await new KaspaMembershipVerifier("https://node.test", () => 0).verifyUtxo(
      transactionId,
      1,
      buyer,
      covenantId,
      creator,
    );

    expect(result.status).toBe("OWNER_MISMATCH");
  });

  it("expires a covenant once current DAA reaches its expiry", async () => {
    const state = memberState({ expiresAtDaa: 400_000n });
    stubChain({ state, daa: "500000" });

    const result = await new KaspaMembershipVerifier("https://node.test", () => 0).verifyUtxo(
      transactionId,
      1,
      buyer,
      covenantId,
      creator,
    );

    expect(result.status).toBe("EXPIRED");
  });

  it("rejects a covenant that is no longer in the UTXO set", async () => {
    const state = memberState();
    stubChain({ state, utxo: false });

    const result = await new KaspaMembershipVerifier("https://node.test", () => 0).verifyUtxo(
      transactionId,
      1,
      buyer,
      covenantId,
      creator,
    );

    expect(result.status).toBe("NOT_MEMBERSHIP");
  });

  it("discovers a membership for the requested creator by scanning the owner address", async () => {
    const state = memberState();
    const redeemScript = membershipRedeemScript(state);
    const payload = membershipPayload(redeemScript, {
      platformAddress: platformFeeAddress,
      createdAtDaa: 136_000n,
      expiresAtDaa: state.expiresAtDaa,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/info/blockdag"))
          return Response.json({ virtualDaaScore: "500000" });
        if (url.includes(`/addresses/${encodeURIComponent(buyer)}/utxos`))
          return Response.json([
            {
              outpoint: { transactionId, index: 4 },
              utxoEntry: { amount: MEMBERSHIP_INDEX_VALUE.toString() },
            },
          ]);
        if (url.includes(`/addresses/${encodeURIComponent(membershipAddress(state))}/utxos`))
          return Response.json([
            {
              outpoint: { transactionId, index: 1 },
              utxoEntry: { amount: MEMBERSHIP_OUTPUT_VALUE.toString() },
            },
          ]);
        if (url.includes(`/transactions/${transactionId}`))
          return Response.json({
            version: 1,
            is_accepted: true,
            payload,
            outputs: [
              {},
              {
                amount: MEMBERSHIP_OUTPUT_VALUE.toString(),
                script_public_key: membershipScript(state).slice(4),
                covenant: { covenantId, authorizingInput: 0 },
              },
            ],
          });
        return new Response("not found", { status: 404 });
      }),
    );

    const verifier = new KaspaMembershipVerifier("https://node.test", () => 0);
    expect((await verifier.findMembership(buyer, creator))?.status).toBe("VALID");
    expect(await verifier.findMembership(buyer, platformFeeAddress)).toBeNull();
  });
});
