import {
  buildMembershipCovenantTemplate,
  createMembershipCovenant,
  fingerprintTemplate,
  MEMBERSHIP_DURATION_MS,
} from "./covenant.js";
import {
  canonicalMembershipCovenantId,
  KaspaMembershipVerifier,
  membershipCovenantId,
  membershipTokenValidity,
  recognizeMembershipDeploy,
  recognizeMembershipToken,
} from "./verifier.js";

const createdAt = 1_700_000_000_000;
const NOW = createdAt + MEMBERSHIP_DURATION_MS / 2;
const creator = `kaspatest:${"c".repeat(60)}`;
const owner = `kaspatest:${"o".repeat(60)}`;
const buyer = `kaspatest:${"b".repeat(60)}`;

function tokenCovenant(overrides: Record<string, unknown> = {}) {
  return {
    type: "KCC-0020",
    payload: {
      type: "MINT",
      owner,
      offerId: "offer-1",
      creator,
      created_at: createdAt,
      valid_until: createdAt + MEMBERSHIP_DURATION_MS,
      ...overrides,
    },
  };
}

describe("membership covenant recognition", () => {
  it("derives the covenant-id exactly as createMembershipCovenant does", () => {
    const covenant = createMembershipCovenant();
    expect(membershipCovenantId(covenant.templateJson)).toBe(covenant.id);
    expect(canonicalMembershipCovenantId()).toBe(
      membershipCovenantId(buildMembershipCovenantTemplate()),
    );
    expect(canonicalMembershipCovenantId().startsWith("covenant-")).toBe(true);
  });

  it("recognizes a MINT token covenant as a membership", () => {
    const token = recognizeMembershipToken(tokenCovenant());
    expect(token).toMatchObject({
      type: "MINT",
      owner,
      offerId: "offer-1",
      creator,
      createdAt,
      validUntil: createdAt + MEMBERSHIP_DURATION_MS,
    });
  });

  it("recognizes a TRANSFER token covenant as a membership", () => {
    const token = recognizeMembershipToken(
      tokenCovenant({
        type: "TRANSFER",
        membershipId: "membership-1",
      }),
    );
    expect(token).toMatchObject({
      type: "TRANSFER",
      owner,
      membershipId: "membership-1",
    });
  });

  it("parses a stringified payload", () => {
    const covenant = tokenCovenant();
    const token = recognizeMembershipToken({
      ...covenant,
      payload: JSON.stringify(covenant.payload),
    });
    expect(token?.owner).toBe(owner);
  });

  it("rejects tokens whose window does not match the canonical duration", () => {
    expect(
      recognizeMembershipToken(tokenCovenant({ valid_until: createdAt + 1 })),
    ).toBeNull();
  });

  it("rejects missing owner or timestamps", () => {
    expect(recognizeMembershipToken(tokenCovenant({ owner: 5 }))).toBeNull();
    expect(
      recognizeMembershipToken(tokenCovenant({ created_at: "later" })),
    ).toBeNull();
    expect(
      recognizeMembershipToken(tokenCovenant({ type: "BURN" })),
    ).toBeNull();
  });

  it("rejects non-KCC-0020 covenants", () => {
    expect(recognizeMembershipToken({ type: "OTHER", payload: {} })).toBeNull();
    expect(recognizeMembershipToken(null)).toBeNull();
    expect(recognizeMembershipToken("covenant")).toBeNull();
  });
});

describe("membership deploy recognition", () => {
  it("recognizes a DEPLOY_COVENANT with a valid fingerprint", () => {
    const template = buildMembershipCovenantTemplate();
    const deploy = recognizeMembershipDeploy({
      type: "KCC-0020",
      payload: {
        type: "DEPLOY_COVENANT",
        templateFingerprint: fingerprintTemplate(template),
        template,
        payoutPk: "payout-pk",
        deployer: creator,
      },
    });
    expect(deploy).toMatchObject({
      type: "DEPLOY_COVENANT",
      template,
      payoutPk: "payout-pk",
      deployer: creator,
    });
    expect(deploy && membershipCovenantId(deploy.template)).toBe(
      canonicalMembershipCovenantId(),
    );
  });

  it("rejects a deploy whose fingerprint does not match its template", () => {
    expect(
      recognizeMembershipDeploy({
        type: "KCC-0020",
        payload: {
          type: "DEPLOY_COVENANT",
          templateFingerprint: "wrong",
          template: buildMembershipCovenantTemplate(),
          payoutPk: "payout-pk",
          deployer: creator,
        },
      }),
    ).toBeNull();
  });
});

describe("membership token validity", () => {
  it("is valid while valid_until is in the future", () => {
    expect(
      membershipTokenValidity(
        recognizeMembershipToken(tokenCovenant())!,
        undefined,
        NOW,
      ),
    ).toBe("VALID");
  });

  it("expires once valid_until passes", () => {
    const token = recognizeMembershipToken(tokenCovenant())!;
    expect(
      membershipTokenValidity(token, undefined, token.validUntil + 1),
    ).toBe("EXPIRED");
    expect(membershipTokenValidity(token, undefined, token.validUntil)).toBe(
      "EXPIRED",
    );
  });

  it("flags an owner mismatch before expiry", () => {
    const token = recognizeMembershipToken(tokenCovenant())!;
    expect(membershipTokenValidity(token, buyer, NOW)).toBe("OWNER_MISMATCH");
    expect(membershipTokenValidity(token, owner, NOW)).toBe("VALID");
  });
});

describe("KaspaMembershipVerifier", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reads the covenant from the creating transaction and validates it", async () => {
    const transactionId = "a".repeat(64);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith(`/addresses/${encodeURIComponent(owner)}/utxos`))
        return new Response(
          JSON.stringify([
            {
              outpoint: { transactionId, index: 1 },
              utxoEntry: {
                amount: "1",
                scriptPublicKey: { scriptPublicKey: "20" + "0".repeat(62) },
                blockDaaScore: "12",
                isCoinbase: false,
              },
            },
          ]),
        );
      if (url.endsWith(`/transactions/${transactionId}`))
        return new Response(
          JSON.stringify({
            outputs: [{ covenant: null }, { covenant: tokenCovenant() }],
          }),
        );
      throw new Error(`unexpected URL ${url}`);
    });

    const verifier = new KaspaMembershipVerifier(
      "https://kaspa.test",
      () => NOW,
    );
    const memberships = await verifier.verifyAddress(owner);
    expect(memberships).toHaveLength(1);
    const membership = memberships[0]!;

    expect(membership).toMatchObject({
      transactionId,
      outputIndex: 1,
      covenantId: canonicalMembershipCovenantId(),
      kind: "token",
      tokenType: "MINT",
      owner,
      status: "VALID",
    });
    expect(membership.createdAt).toBe(new Date(createdAt).toISOString());
    expect(membership.validUntil).toBe(
      new Date(createdAt + MEMBERSHIP_DURATION_MS).toISOString(),
    );
  });

  it("marks an expired token and resolves a mismatched owner", async () => {
    const transactionId = "b".repeat(64);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith(`/addresses/${encodeURIComponent(owner)}/utxos`))
        return new Response(
          JSON.stringify([
            {
              outpoint: { transactionId, index: 0 },
              utxoEntry: { amount: "1" },
            },
            {
              outpoint: { transactionId, index: 1 },
              utxoEntry: { amount: "1" },
            },
          ]),
        );
      if (url.endsWith(`/transactions/${transactionId}`))
        return new Response(
          JSON.stringify({
            outputs: [
              {
                covenant: tokenCovenant({
                  created_at: NOW - 1 - MEMBERSHIP_DURATION_MS,
                  valid_until: NOW - 1,
                }),
              },
              { covenant: tokenCovenant() },
            ],
          }),
        );
      throw new Error(`unexpected URL ${url}`);
    });

    const verifier = new KaspaMembershipVerifier(
      "https://kaspa.test",
      () => NOW,
    );
    const memberships = await verifier.verifyAddress(owner);
    expect(memberships).toHaveLength(2);
    expect(memberships[0]!.status).toBe("EXPIRED");
    expect(memberships[1]!.status).toBe("VALID");

    const checked = await verifier.verifyAddress(owner, buyer);
    expect(checked[0]!.status).toBe("OWNER_MISMATCH");
    expect(checked[1]!.status).toBe("OWNER_MISMATCH");
  });

  it("prefers a covenant embedded in the utxo entry", async () => {
    const transactionId = "c".repeat(64);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith(`/addresses/${encodeURIComponent(owner)}/utxos`))
          return new Response(
            JSON.stringify([
              {
                outpoint: { transactionId, index: 0 },
                utxoEntry: {
                  amount: "1",
                  covenant: tokenCovenant(),
                },
              },
            ]),
          );
        throw new Error(`unexpected URL ${url}`);
      });

    const verifier = new KaspaMembershipVerifier(
      "https://kaspa.test",
      () => NOW,
    );
    const memberships = await verifier.verifyAddress(owner);
    expect(memberships).toHaveLength(1);
    const membership = memberships[0]!;

    expect(membership.status).toBe("VALID");
    expect(
      fetchMock.mock.calls.every(([input]) =>
        String(input).includes("/addresses/"),
      ),
    ).toBe(true);
  });

  it("categorizes non-membership outputs as NOT_MEMBERSHIP", async () => {
    const transactionId = "d".repeat(64);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith(`/transactions/${transactionId}`))
        return new Response(
          JSON.stringify({
            outputs: [{ covenant: null }, { covenant: { type: "OTHER" } }],
          }),
        );
      throw new Error(`unexpected URL ${url}`);
    });

    const verifier = new KaspaMembershipVerifier(
      "https://kaspa.test",
      () => NOW,
    );
    const none = await verifier.verifyUtxo(transactionId, 0);
    const other = await verifier.verifyUtxo(transactionId, 1);

    expect(none.status).toBe("NOT_MEMBERSHIP");
    expect(none.covenantId).toBeNull();
    expect(other.status).toBe("NOT_MEMBERSHIP");
  });

  it("exposes a recognized deploy covenant with its covenant-id", async () => {
    const transactionId = "e".repeat(64);
    const template = buildMembershipCovenantTemplate();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith(`/transactions/${transactionId}`))
        return new Response(
          JSON.stringify({
            outputs: [
              {
                covenant: {
                  type: "KCC-0020",
                  payload: {
                    type: "DEPLOY_COVENANT",
                    templateFingerprint: fingerprintTemplate(template),
                    template,
                    payoutPk: "payout-pk",
                    deployer: creator,
                  },
                },
              },
            ],
          }),
        );
      throw new Error(`unexpected URL ${url}`);
    });

    const verifier = new KaspaMembershipVerifier(
      "https://kaspa.test",
      () => NOW,
    );
    const deploy = await verifier.verifyUtxo(transactionId, 0);

    expect(deploy.status).toBe("NOT_MEMBERSHIP");
    expect(deploy.kind).toBe("deploy");
    expect(deploy.covenantId).toBe(canonicalMembershipCovenantId());
  });
});
