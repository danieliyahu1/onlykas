import { createHash } from "node:crypto";
import { KaspaCovenantGateway } from "./covenant-gateway.js";
import {
  createMembershipCovenant,
  computeCreatorRoyalty,
} from "./covenant.js";
import type { MembershipOffer } from "./domain.js";

function baseTransaction(
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    id: "0".repeat(64),
    version: 0,
    inputs: [
      {
        transactionId: "b".repeat(64),
        index: 0,
        sequence: "0",
        sigOpCount: 1,
        computeBudget: 0,
        signatureScript: "",
        utxo: {
          amount: "200",
          scriptPublicKey: `0000${"20" + "b".repeat(64) + "ac"}`,
          blockDaaScore: "1",
          isCoinbase: false,
        },
      },
    ],
    outputs: [
      {
        value: "100",
        scriptPublicKey: "000020" + "c".repeat(64) + "ac",
        covenant: null,
      },
    ],
    subnetworkId: "0".repeat(40),
    lockTime: "0",
    gas: "0",
    storageMass: "20000",
    payload: "",
    ...overrides,
  };
}

function fingerprint(transaction: unknown): string {
  return createHash("sha256").update(JSON.stringify(transaction)).digest("hex");
}

function testOffer(overrides: Partial<MembershipOffer> = {}): MembershipOffer {
  return {
    id: "offer-1",
    creator: "creator",
    covenantId: "covenant-1",
    priceSompi: "100",
    description: "Monthly membership",
    isActive: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("Kaspa covenant gateway", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects every unsigned transaction mutation before broadcast", async () => {
    const transaction = baseTransaction();
    const prepared = {
      transaction: JSON.stringify(transaction),
      fingerprint: fingerprint(transaction),
      saleAmountSompi: "100",
      creatorRoyaltySompi: "100",
      seller: "seller",
      buyer: "buyer",
    };
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const signed = { ...transaction, lockTime: "1" };

    await expect(
      new KaspaCovenantGateway("https://kaspa.test").submit(
        prepared,
        JSON.stringify(signed),
      ),
    ).resolves.toMatchObject({
      isAccepted: false,
      rejection: "PREPARED_TRANSACTION_CHANGED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates royalty split before broadcast", async () => {
    const covenant = createMembershipCovenant();
    const offer = testOffer({ priceSompi: "1000" });
    const royalty = computeCreatorRoyalty(
      offer.priceSompi,
      covenant.creatorRoyaltyBps,
    );
    const sellerAmount = (BigInt(offer.priceSompi) - BigInt(royalty)).toString();
    const transaction = baseTransaction({
      outputs: [
        {
          value: royalty,
          scriptPublicKey: "000020" + "d".repeat(64) + "ac",
          covenant: { type: "KCC-0020", payload: { type: "TRANSFER" } },
        },
        {
          value: sellerAmount,
          scriptPublicKey: "000020" + "e".repeat(64) + "ac",
          covenant: null,
        },
      ],
    });
    const prepared = {
      transaction: JSON.stringify(transaction),
      fingerprint: fingerprint(transaction),
      saleAmountSompi: offer.priceSompi,
      creatorRoyaltySompi: royalty,
      seller: "seller",
      buyer: "buyer",
    };
    const txid = "c".repeat(64);
    const parentScript = "20" + "b".repeat(64) + "ac";
vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith(`/transactions/${"b".repeat(64)}`))
        return new Response(
          JSON.stringify({
            outputs: [{ amount: 200, script_public_key: parentScript }],
          }),
        );
      if (url.endsWith("/transactions") && init?.method === "POST")
        return new Response(JSON.stringify({ transactionId: txid }));
      if (url.endsWith(`/transactions/${txid}`))
        return new Response(JSON.stringify({ is_accepted: true }));
      throw new Error(`unexpected URL ${url}`);
    });
    const signed = {
      ...transaction,
      inputs: [
        { ...transaction.inputs[0], signatureScript: "aa01" },
      ],
    };

    await expect(
      new KaspaCovenantGateway("https://kaspa.test").submit(
        prepared,
        JSON.stringify(signed),
      ),
    ).resolves.toMatchObject({
      isAccepted: true,
      transactionId: expect.any(String),
    });
  });

  it("rejects when royalty split is violated", async () => {
    const transaction = baseTransaction({
      outputs: [
        {
          value: "50",
          scriptPublicKey: "000020" + "d".repeat(64) + "ac",
          covenant: { type: "KCC-0020", payload: { type: "TRANSFER" } },
        },
        {
          value: "950",
          scriptPublicKey: "000020" + "e".repeat(64) + "ac",
          covenant: null,
        },
      ],
    });
    const prepared = {
      transaction: JSON.stringify(transaction),
      fingerprint: fingerprint(transaction),
      saleAmountSompi: "1000",
      creatorRoyaltySompi: "50",
      seller: "seller",
      buyer: "buyer",
    };
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const signed = {
      ...transaction,
      inputs: [
        { ...transaction.inputs[0], signatureScript: "aa01" },
      ],
    };

    await expect(
      new KaspaCovenantGateway("https://kaspa.test").submit(
        prepared,
        JSON.stringify(signed),
      ),
    ).resolves.toMatchObject({
      isAccepted: false,
      rejection: "ROYALTY_SPLIT_VIOLATION",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON signed transactions", async () => {
    const prepared = {
      transaction: JSON.stringify(baseTransaction()),
      fingerprint: fingerprint(baseTransaction()),
      saleAmountSompi: "100",
      creatorRoyaltySompi: "10",
      seller: "seller",
      buyer: "buyer",
    };
    await expect(
      new KaspaCovenantGateway("https://kaspa.test").submit(
        prepared,
        "not-json",
      ),
    ).resolves.toMatchObject({
      isAccepted: false,
      rejection: "INVALID_TRANSACTION",
    });
  });

  it("rejects a signature without SIGHASH_ALL", async () => {
    const transaction = baseTransaction();
    const prepared = {
      transaction: JSON.stringify(transaction),
      fingerprint: fingerprint(transaction),
      saleAmountSompi: "100",
      creatorRoyaltySompi: "10",
      seller: "seller",
      buyer: "buyer",
    };
    await expect(
      new KaspaCovenantGateway("https://kaspa.test").submit(
        prepared,
        JSON.stringify({
          ...transaction,
          inputs: [{ ...transaction.inputs[0], signatureScript: "aabb" }],
        }),
      ),
    ).resolves.toMatchObject({
      isAccepted: false,
      rejection: "INVALID_SIGNATURES",
    });
  });

  it("prepares a funded covenant deploy signed by the deployer", async () => {
    const covenant = createMembershipCovenant();
    const deployer = `kaspatest:${"q".repeat(61)}`;
    const utxoScript = `20${"00".repeat(32)}ac`;
    vi.spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith(`/addresses/${encodeURIComponent(deployer)}/utxos`))
          return new Response(
            JSON.stringify([
              {
                outpoint: { transactionId: "b".repeat(64), index: 0 },
                utxoEntry: {
                  amount: "200",
                  scriptPublicKey: { scriptPublicKey: utxoScript },
                  blockDaaScore: "1",
                  isCoinbase: false,
                },
              },
            ]),
          );
        if (url.endsWith("/info/fee-estimate"))
          return new Response(
            JSON.stringify({
              normalBuckets: [{ feerate: 0.01 }],
              priorityBucket: { feerate: 0.02 },
            }),
          );
        throw new Error(`unexpected URL ${url}`);
      });

    const prepared = await new KaspaCovenantGateway("https://kaspa.test")
      .prepareDeploy(covenant, deployer, "payout-pk");

    expect(prepared.covenantId).toBe(covenant.id);
    const transaction = JSON.parse(prepared.transaction);
    expect(transaction.inputs[0]).toMatchObject({
      utxo: { amount: "200" },
    });
    expect(transaction.outputs[0]).toMatchObject({
      value: covenant.amount,
      covenant: { type: "KCC-0020" },
    });
    expect(JSON.parse(transaction.outputs[0].covenant.payload)).toEqual({
      type: "DEPLOY_COVENANT",
      templateFingerprint: covenant.templateFingerprint,
      template: covenant.templateJson,
      payoutPk: "payout-pk",
      deployer,
    });
    expect(prepared.fingerprint).toBe(
      createHash("sha256").update(prepared.transaction).digest("hex"),
    );
  });

  it("deploy rejects template fingerprint mismatch before funding", async () => {
    const covenant = createMembershipCovenant();
    covenant.templateFingerprint = "wrong";
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(
      new KaspaCovenantGateway("https://kaspa.test").prepareDeploy(
        covenant,
        `kaspatest:${"q".repeat(61)}`,
        "payout-pk",
      ),
    ).rejects.toThrow("TEMPLATE_FINGERPRINT_MISMATCH");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submitDeploy broadcasts only a signed, unchanged deploy", async () => {
    const transaction = baseTransaction({
      outputs: [
        {
          value: "1",
          scriptPublicKey: "000020" + "c".repeat(64) + "ac",
          covenant: { type: "KCC-0020", payload: { type: "DEPLOY_COVENANT" } },
        },
      ],
    });
    const prepared = {
      transaction: JSON.stringify(transaction),
      fingerprint: fingerprint(transaction),
      covenantId: "covenant-1",
    };
    const txid = "c".repeat(64);
    const parentScript = "20" + "b".repeat(64) + "ac";
    vi.spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith(`/transactions/${"b".repeat(64)}`))
          return new Response(
            JSON.stringify({
              outputs: [{ amount: 200, script_public_key: parentScript }],
            }),
          );
        if (url.endsWith("/transactions") && init?.method === "POST")
          return new Response(JSON.stringify({ transactionId: txid }));
        if (url.endsWith(`/transactions/${txid}`))
          return new Response(JSON.stringify({ is_accepted: true }));
        throw new Error(`unexpected URL ${url}`);
      });
    const signed = {
      ...transaction,
      inputs: [{ ...transaction.inputs[0], signatureScript: "aa01" }],
    };

    await expect(
      new KaspaCovenantGateway("https://kaspa.test").submitDeploy(
        prepared,
        JSON.stringify(signed),
      ),
    ).resolves.toMatchObject({
      isAccepted: true,
      transactionId: txid,
    });
  });

  it("computeCreatorRoyalty matches gateway expectation", () => {
    expect(computeCreatorRoyalty("1000", 1000)).toBe("100");
    expect(computeCreatorRoyalty("1001", 1000)).toBe("101");
  });
});
