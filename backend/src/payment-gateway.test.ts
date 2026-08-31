import { createHash } from "node:crypto";
import { KaspaPaymentGateway } from "./payment-gateway.js";

describe("Kaspa payment gateway", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects every unsigned transaction mutation before broadcast", async () => {
    const transaction = baseTransaction();
    const prepared = {
      transaction: JSON.stringify(transaction),
      fingerprint: fingerprint(transaction),
      amountSompi: "100",
      creator: "creator",
    };
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const signed = { ...transaction, lockTime: "1" };

    await expect(
      new KaspaPaymentGateway("https://kaspa.test").submit(
        prepared,
        JSON.stringify(signed),
      ),
    ).resolves.toMatchObject({
      isAccepted: false,
      rejection: "PREPARED_TRANSACTION_CHANGED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-fetches inputs, requires SIGHASH_ALL, and confirms accepted REST submissions", async () => {
    const transaction = baseTransaction();
    const prepared = {
      transaction: JSON.stringify(transaction),
      fingerprint: fingerprint(transaction),
      amountSompi: "100",
      creator: "creator",
    };
    const txid = "a".repeat(64);
    const parentScript = "20" + "b".repeat(64) + "ac";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
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
    transaction.inputs[0]!.transactionId = "b".repeat(64);
    transaction.inputs[0]!.utxo.scriptPublicKey = `0000${parentScript}`;
    prepared.transaction = JSON.stringify(transaction);
    prepared.fingerprint = fingerprint(transaction);

    await expect(
      new KaspaPaymentGateway("https://kaspa.test").submit(
        prepared,
        JSON.stringify({
          ...transaction,
          inputs: [{ ...transaction.inputs[0], signatureScript: "aa01" }],
        }),
      ),
    ).resolves.toEqual({
      isAccepted: true,
      transactionId: txid,
      rejection: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const post = fetchMock.mock.calls[1]?.[1];
    expect(JSON.parse(String(post?.body))).toMatchObject({
      allowOrphan: false,
    });
  });

  it("rejects a signature without SIGHASH_ALL", async () => {
    const transaction = baseTransaction();
    const prepared = {
      transaction: JSON.stringify(transaction),
      fingerprint: fingerprint(transaction),
      amountSompi: "100",
      creator: "creator",
    };
    await expect(
      new KaspaPaymentGateway().submit(
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
});

function baseTransaction() {
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
  };
}

function fingerprint(transaction: unknown): string {
  return createHash("sha256").update(JSON.stringify(transaction)).digest("hex");
}
