import { createHash } from "node:crypto";
import type {
  CovenantGateway,
  Membership,
  MembershipCovenant,
  MembershipDeploySubmission,
  MembershipOffer,
  MembershipTransferSubmission,
  PreparedMembershipDeploy,
  PreparedMembershipTransfer,
} from "./domain.js";
import {
  computeCreatorRoyalty,
  fingerprintTemplate,
  verifyRoyaltySplit,
} from "./covenant.js";

const ZERO_SUBNETWORK = "0".repeat(40);

export class KaspaCovenantGateway implements CovenantGateway {
  constructor(private readonly api = "https://api-tn10.kaspa.org") {}

  async prepareDeploy(
    covenant: MembershipCovenant,
    deployer: string,
    payoutPk: string,
  ): Promise<PreparedMembershipDeploy> {
    const verified = fingerprintTemplate(covenant.templateJson);
    if (verified !== covenant.templateFingerprint)
      throw new Error("TEMPLATE_FINGERPRINT_MISMATCH");
    const amount = BigInt(covenant.amount);
    const [utxos, feeEstimate] = await Promise.all([
      this.request<Utxo[]>(
        `/addresses/${encodeURIComponent(deployer)}/utxos`,
      ),
      this.request<{
        normalBuckets: { feerate: number }[];
        priorityBucket: { feerate: number };
      }>("/info/fee-estimate"),
    ]);
    const rate =
      feeEstimate.normalBuckets[0]?.feerate ??
      feeEstimate.priorityBucket.feerate;
    const selected: Utxo[] = [];
    let total = 0n;
    for (const utxo of [...utxos].sort((a, b) =>
      Number(BigInt(b.utxoEntry.amount) - BigInt(a.utxoEntry.amount)),
    )) {
      selected.push(utxo);
      total += BigInt(utxo.utxoEntry.amount);
      const fee = estimatedFee(selected.length, rate);
      if (total >= amount + fee) break;
    }
    const fee = estimatedFee(selected.length, rate);
    if (total < amount + fee) throw new Error("INSUFFICIENT_FUNDS");
    const deployerScript = scriptFor(deployer);
    if (
      selected.some(
        (utxo) =>
          `0000${utxo.utxoEntry.scriptPublicKey.scriptPublicKey}` !==
          deployerScript,
      )
    )
      throw new Error("UTXO_OWNER_MISMATCH");
    const payload = JSON.stringify({
      type: "DEPLOY_COVENANT",
      templateFingerprint: covenant.templateFingerprint,
      template: covenant.templateJson,
      payoutPk,
      deployer,
    });
    const outputs: {
      value: string;
      scriptPublicKey: string;
      covenant: Record<string, unknown> | null;
    }[] = [
      {
        value: amount.toString(),
        scriptPublicKey: deployerScript,
        covenant: {
          type: "KCC-0020",
          payload,
        },
      },
    ];
    const change = total - amount - fee;
    if (change > 0n)
      outputs.push({
        value: change.toString(),
        scriptPublicKey: deployerScript,
        covenant: null,
      });
    const transaction = JSON.stringify({
      id: "0".repeat(64),
      version: 0,
      inputs: selected.map((utxo) => ({
        transactionId: utxo.outpoint.transactionId,
        index: utxo.outpoint.index,
        sequence: "0",
        sigOpCount: 1,
        computeBudget: 0,
        signatureScript: "",
        utxo: {
          amount: utxo.utxoEntry.amount,
          scriptPublicKey: `0000${utxo.utxoEntry.scriptPublicKey.scriptPublicKey}`,
          blockDaaScore: utxo.utxoEntry.blockDaaScore,
          isCoinbase: utxo.utxoEntry.isCoinbase,
        },
      })),
      outputs,
      subnetworkId: ZERO_SUBNETWORK,
      lockTime: "0",
      gas: "0",
      storageMass: "20000",
      payload: "",
    });
    return {
      transaction,
      fingerprint: digest(transaction),
      covenantId: covenant.id,
    };
  }

  async mint(
    offer: MembershipOffer,
    buyer: string,
  ): Promise<PreparedMembershipTransfer> {
    const amount = BigInt(offer.priceSompi);
    const createdAt = Date.now();
    const validUntil = createdAt + 24 * 60 * 60 * 1_000;
    const [utxos, feeEstimate] = await Promise.all([
      this.request<Utxo[]>(`/addresses/${encodeURIComponent(buyer)}/utxos`),
      this.request<{
        normalBuckets: { feerate: number }[];
        priorityBucket: { feerate: number };
      }>("/info/fee-estimate"),
    ]);
    const rate =
      feeEstimate.normalBuckets[0]?.feerate ??
      feeEstimate.priorityBucket.feerate;
    const selected: Utxo[] = [];
    let total = 0n;
    for (const utxo of [...utxos].sort((a, b) =>
      Number(BigInt(b.utxoEntry.amount) - BigInt(a.utxoEntry.amount)),
    )) {
      selected.push(utxo);
      total += BigInt(utxo.utxoEntry.amount);
      const fee = estimatedFee(selected.length, rate);
      if (total >= amount + fee) break;
    }
    const fee = estimatedFee(selected.length, rate);
    if (total < amount + fee) throw new Error("INSUFFICIENT_FUNDS");
    const covenantPayload = {
      type: "MINT",
      owner: buyer,
      offerId: offer.id,
      creator: offer.creator,
      created_at: createdAt,
      valid_until: validUntil,
    };
    const outputs: {
      value: string;
      scriptPublicKey: string;
      covenant: Record<string, unknown> | null;
    }[] = [
      {
        value: "1",
        scriptPublicKey: scriptFor(offer.creator),
        covenant: {
          type: "KCC-0020",
          payload: covenantPayload,
        },
      },
    ];
    const buyerScript = scriptFor(buyer);
    if (
      selected.some(
        (utxo) =>
          `0000${utxo.utxoEntry.scriptPublicKey.scriptPublicKey}` !==
          buyerScript,
      )
    )
      throw new Error("UTXO_OWNER_MISMATCH");
    const change = total - amount - fee;
    if (change > 0n)
      outputs.push({
        value: change.toString(),
        scriptPublicKey: buyerScript,
        covenant: null,
      });
    const transaction = JSON.stringify({
      id: "0".repeat(64),
      version: 0,
      inputs: selected.map((utxo) => ({
        transactionId: utxo.outpoint.transactionId,
        index: utxo.outpoint.index,
        sequence: "0",
        sigOpCount: 1,
        computeBudget: 0,
        signatureScript: "",
        utxo: {
          amount: utxo.utxoEntry.amount,
          scriptPublicKey: `0000${utxo.utxoEntry.scriptPublicKey.scriptPublicKey}`,
          blockDaaScore: utxo.utxoEntry.blockDaaScore,
          isCoinbase: utxo.utxoEntry.isCoinbase,
        },
      })),
      outputs,
      subnetworkId: ZERO_SUBNETWORK,
      lockTime: "0",
      gas: "0",
      storageMass: "20000",
      payload: "",
    });
    return {
      transaction,
      fingerprint: digest(transaction),
      saleAmountSompi: offer.priceSompi,
      creatorRoyaltySompi: offer.priceSompi,
      seller: offer.creator,
      buyer,
    };
  }

  async transfer(
    membership: Membership,
    buyer: string,
    saleAmountSompi: string,
  ): Promise<PreparedMembershipTransfer> {
    const royaltyBps = 1000;
    const creatorRoyalty = computeCreatorRoyalty(saleAmountSompi, royaltyBps);
    const sellerAmount = (BigInt(saleAmountSompi) - BigInt(creatorRoyalty)).toString();
    const [utxos, feeEstimate] = await Promise.all([
      this.request<Utxo[]>(
        `/addresses/${encodeURIComponent(membership.owner)}/utxos`,
      ),
      this.request<{
        normalBuckets: { feerate: number }[];
        priorityBucket: { feerate: number };
      }>("/info/fee-estimate"),
    ]);
    const rate =
      feeEstimate.normalBuckets[0]?.feerate ??
      feeEstimate.priorityBucket.feerate;
    const selected: Utxo[] = [];
    let total = 0n;
    const needed = BigInt(saleAmountSompi);
    for (const utxo of [...utxos].sort((a, b) =>
      Number(BigInt(b.utxoEntry.amount) - BigInt(a.utxoEntry.amount)),
    )) {
      selected.push(utxo);
      total += BigInt(utxo.utxoEntry.amount);
      const fee = estimatedFee(selected.length + 2, rate);
      if (total >= needed + fee) break;
    }
    const fee = estimatedFee(selected.length + 2, rate);
    if (total < needed + fee) throw new Error("INSUFFICIENT_FUNDS");
    const covenantPayload = {
      type: "TRANSFER",
      membershipId: membership.id,
      owner: buyer,
      created_at: membership.createdAt,
      valid_until: membership.validUntil,
    };
    const outputs: {
      value: string;
      scriptPublicKey: string;
      covenant: Record<string, unknown> | null;
    }[] = [
      {
        value: creatorRoyalty,
        scriptPublicKey: scriptFor(membership.creator),
        covenant: {
          type: "KCC-0020",
          payload: covenantPayload,
        },
      },
      {
        value: sellerAmount,
        scriptPublicKey: scriptFor(membership.owner),
        covenant: null,
      },
    ];
    const sellerScript = scriptFor(membership.owner);
    if (
      selected.some(
        (utxo) =>
          `0000${utxo.utxoEntry.scriptPublicKey.scriptPublicKey}` !==
          sellerScript,
      )
    )
      throw new Error("UTXO_OWNER_MISMATCH");
    const change = total - needed - fee;
    if (change > 0n)
      outputs.push({
        value: change.toString(),
        scriptPublicKey: sellerScript,
        covenant: null,
      });
    const transaction = JSON.stringify({
      id: "0".repeat(64),
      version: 0,
      inputs: selected.map((utxo) => ({
        transactionId: utxo.outpoint.transactionId,
        index: utxo.outpoint.index,
        sequence: "0",
        sigOpCount: 1,
        computeBudget: 0,
        signatureScript: "",
        utxo: {
          amount: utxo.utxoEntry.amount,
          scriptPublicKey: `0000${utxo.utxoEntry.scriptPublicKey.scriptPublicKey}`,
          blockDaaScore: utxo.utxoEntry.blockDaaScore,
          isCoinbase: utxo.utxoEntry.isCoinbase,
        },
      })),
      outputs,
      subnetworkId: ZERO_SUBNETWORK,
      lockTime: "0",
      gas: "0",
      storageMass: "20000",
      payload: "",
    });
    return {
      transaction,
      fingerprint: digest(transaction),
      saleAmountSompi,
      creatorRoyaltySompi: creatorRoyalty,
      seller: membership.owner,
      buyer,
    };
  }

  async submitDeploy(
    prepared: PreparedMembershipDeploy,
    signedTransaction: string,
  ): Promise<MembershipDeploySubmission> {
    return this.submitCommon(prepared, signedTransaction, false);
  }

  async submit(
    prepared: PreparedMembershipTransfer,
    signedTransaction: string,
  ): Promise<MembershipTransferSubmission> {
    return this.submitCommon(prepared, signedTransaction, true);
  }

  async submitMint(
    prepared: PreparedMembershipTransfer,
    signedTransaction: string,
  ): Promise<MembershipTransferSubmission> {
    return this.submitCommon(prepared, signedTransaction, false);
  }

  private async submitCommon(
    prepared: PreparedMembershipTransfer | PreparedMembershipDeploy,
    signedTransaction: string,
    verifySplit: boolean,
  ): Promise<MembershipTransferSubmission> {
    let transaction: unknown;
    try {
      transaction = JSON.parse(signedTransaction);
    } catch {
      return {
        isAccepted: false,
        transactionId: null,
        rejection: "INVALID_TRANSACTION",
        acceptedAt: null,
      };
    }
    const original = JSON.parse(prepared.transaction) as Record<
      string,
      unknown
    >;
    const signed = transaction as Record<string, unknown>;
    if (!isTransactionShape(original) || !isTransactionShape(signed))
      return {
        isAccepted: false,
        transactionId: null,
        rejection: "INVALID_TRANSACTION",
        acceptedAt: null,
      };
    if (digest(prepared.transaction) !== prepared.fingerprint)
      return {
        isAccepted: false,
        transactionId: null,
        rejection: "INVALID_PREPARED_TEMPLATE",
        acceptedAt: null,
      };
    if (!sameTransaction(original, signed))
      return {
        isAccepted: false,
        transactionId: null,
        rejection: "PREPARED_TRANSACTION_CHANGED",
        acceptedAt: null,
      };
    if (!hasAllSignatures(signed))
      return {
        isAccepted: false,
        transactionId: null,
        rejection: "INVALID_SIGNATURES",
        acceptedAt: null,
      };
    if (verifySplit && "saleAmountSompi" in prepared) {
      const outputs = signed.outputs as Record<string, unknown>[];
      const royaltyOutputs = outputs.map((o) => ({
        value: String(o.value ?? o.amount ?? "0"),
        covenant: o.covenant as Record<string, unknown> | null,
      }));
      if (
        !verifyRoyaltySplit(
          royaltyOutputs,
          prepared.saleAmountSompi,
          1000,
        )
      )
        return {
          isAccepted: false,
          transactionId: null,
          rejection: "ROYALTY_SPLIT_VIOLATION",
          acceptedAt: null,
        };
    }
    await validateAuthoritativeInputs(signed, (path, init) =>
      this.request(path, init),
    );
    let result: { transactionId?: string; error?: string };
    try {
      result = await this.request<{ transactionId?: string; error?: string }>(
        "/transactions",
        {
          method: "POST",
          body: JSON.stringify({
            transaction: toSubmitTransaction(signed),
            allowOrphan: false,
          }),
        },
      );
    } catch (error) {
      const transactionId = /transaction ([0-9a-f]{64})/i.exec(
        error instanceof Error ? error.message : "",
      )?.[1];
      if (!transactionId) throw error;
      try {
        return await this.status(transactionId);
      } catch {
        return { isAccepted: null, transactionId, rejection: null, acceptedAt: null };
      }
    }
    if (result.error || !result.transactionId)
      return {
        isAccepted: false,
        transactionId: result.transactionId ?? null,
        rejection: result.error ?? "TRANSACTION_REJECTED",
        acceptedAt: null,
      };
    try {
      return await this.status(result.transactionId);
    } catch {
      return {
        isAccepted: null,
        transactionId: result.transactionId,
        rejection: null,
        acceptedAt: null,
      };
    }
  }

  async status(transactionId: string): Promise<MembershipTransferSubmission> {
    const status = await this.request<{
      is_accepted: boolean;
      block_time?: number;
    }>(`/transactions/${transactionId}`);
    return {
      isAccepted: status.is_accepted ? true : null,
      transactionId,
      rejection: null,
      acceptedAt: blockTimeToMs(status.block_time),
    };
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.api}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Kaspa request failed: ${response.status} ${detail}`);
    }
    return (await response.json()) as T;
  }
}

type Utxo = {
  outpoint: { transactionId: string; index: number };
  utxoEntry: {
    amount: string;
    scriptPublicKey: { scriptPublicKey: string };
    blockDaaScore: string;
    isCoinbase: boolean;
  };
};

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function scriptFor(address: string): string {
  const data = address
    .slice(address.lastIndexOf(":") + 1, -8)
    .split("")
    .map((char) => CHARSET.indexOf(char));
  const bytes: number[] = [];
  let buffer = 0n;
  let bits = 0;
  for (const value of data) {
    buffer = (buffer << 5n) | BigInt(value);
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push(Number((buffer >> BigInt(bits)) & 255n));
      buffer &= (1n << BigInt(bits)) - 1n;
    }
  }
  if (bytes[0] !== 0 || bytes.length !== 33)
    throw new Error("INVALID_ADDRESS");
  return `000020${bytes
    .slice(1)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}ac`;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function blockTimeToMs(blockTime: number | undefined): number | null {
  if (!blockTime || blockTime <= 0) return null;
  return blockTime < 10 ** 12 ? blockTime * 1000 : blockTime;
}

function estimatedFee(inputCount: number, rate: number): bigint {
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("INVALID_FEE_RATE");
  return BigInt(Math.ceil((2036 + 1000 * inputCount) * rate));
}

function hasAllSignatures(transaction: Record<string, unknown>): boolean {
  const inputs = transaction.inputs;
  if (!Array.isArray(inputs) || inputs.length === 0) return false;
  return inputs.every((value) => {
    if (!value || typeof value !== "object") return false;
    const signature = (value as Record<string, unknown>).signatureScript;
    return (
      typeof signature === "string" &&
      signature.length > 0 &&
      signature.length % 2 === 0 &&
      /^[0-9a-f]+$/i.test(signature) &&
      signature.endsWith("01")
    );
  });
}

async function validateAuthoritativeInputs(
  transaction: Record<string, unknown>,
  request: (path: string, init?: RequestInit) => Promise<unknown>,
): Promise<void> {
  const inputs = transaction.inputs as Record<string, unknown>[];
  for (const input of inputs) {
    const transactionId = input.transactionId;
    const index = input.index;
    if (
      typeof transactionId !== "string" ||
      !/^[0-9a-f]{64}$/i.test(transactionId) ||
      typeof index !== "number" ||
      !Number.isInteger(index) ||
      index < 0
    )
      throw new Error("INVALID_INPUT");
    const parent = (await request(`/transactions/${transactionId}`)) as {
      outputs?: {
        index?: number;
        amount: number | string;
        script_public_key:
          | string
          | { script_public_key?: string; scriptPublicKey?: string };
      }[];
    };
    const output = parent.outputs?.[index];
    const utxo = input.utxo as Record<string, unknown> | undefined;
    if (!output || !utxo || String(output.amount) !== String(utxo.amount))
      throw new Error("INPUT_CHANGED");
    const script =
      typeof output.script_public_key === "string"
        ? output.script_public_key
        : (output.script_public_key.script_public_key ??
          output.script_public_key.scriptPublicKey);
    if (!script) throw new Error("INPUT_CHANGED");
    const authoritativeScript = script.startsWith("0000")
      ? script
      : `0000${script}`;
    if (authoritativeScript !== utxo.scriptPublicKey)
      throw new Error("INPUT_CHANGED");
  }
}

function isTransactionShape(transaction: Record<string, unknown>): boolean {
  return (
    transaction.version === 0 &&
    Array.isArray(transaction.inputs) &&
    Array.isArray(transaction.outputs) &&
    typeof transaction.subnetworkId === "string" &&
    typeof transaction.lockTime === "string" &&
    typeof transaction.gas === "string" &&
    typeof transaction.storageMass === "string" &&
    typeof transaction.payload === "string"
  );
}

function sameTransaction(
  original: Record<string, unknown>,
  signed: Record<string, unknown>,
): boolean {
  const keys = [
    "version",
    "outputs",
    "subnetworkId",
    "lockTime",
    "gas",
    "storageMass",
    "payload",
  ];
  if (
    !keys.every(
      (key) => JSON.stringify(original[key]) === JSON.stringify(signed[key]),
    )
  )
    return false;
  const normalizeInputs = (value: unknown) =>
    (value as Record<string, unknown>[]).map((input) => {
      const utxo = input.utxo as Record<string, unknown>;
      return {
        transactionId: input.transactionId,
        index: input.index,
        sequence: input.sequence,
        sigOpCount: input.sigOpCount,
        computeBudget: input.computeBudget ?? 0,
        utxo: {
          amount: utxo.amount,
          scriptPublicKey: utxo.scriptPublicKey,
          blockDaaScore: utxo.blockDaaScore,
          isCoinbase: utxo.isCoinbase,
        },
      };
    });
  return (
    JSON.stringify(normalizeInputs(original.inputs)) ===
    JSON.stringify(normalizeInputs(signed.inputs))
  );
}

function toSubmitTransaction(transaction: Record<string, unknown>) {
  const inputs = transaction.inputs as Record<string, unknown>[];
  const outputs = transaction.outputs as Record<string, unknown>[];
  return {
    version: transaction.version,
    inputs: inputs.map((input) => ({
      previousOutpoint: {
        transactionId: input.transactionId,
        index: input.index,
      },
      signatureScript: input.signatureScript,
      sequence: Number(input.sequence),
      sigOpCount: input.sigOpCount,
    })),
    outputs: outputs.map((output) => ({
      amount: Number(output.value),
      scriptPublicKey: {
        version: parseInt(String(output.scriptPublicKey).slice(0, 4), 16),
        scriptPublicKey: String(output.scriptPublicKey).slice(4),
      },
      covenant: output.covenant,
    })),
    lockTime: Number(transaction.lockTime),
    subnetworkId: transaction.subnetworkId,
  };
}
