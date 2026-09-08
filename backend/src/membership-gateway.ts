import { createHash } from "node:crypto";
import {
  covenantId,
  payToScriptHashScript,
  TransactionOutput,
} from "@kluster/kaspa-wasm";
import type {
  MembershipGateway,
  PaymentSubmission,
  PreparedMembershipTransaction,
} from "./domain.js";
import {
  addressPublicKey,
  addressScript,
  MEMBERSHIP_DURATION_DAA,
  MEMBERSHIP_INDEX_VALUE,
  MEMBERSHIP_OUTPUT_VALUE,
  MEMBERSHIP_PRICE_SOMPI,
  membershipAddress,
  membershipMintSignatureScript,
  membershipPayload,
  membershipRedeemScript,
  membershipScript,
  type MembershipState,
} from "./membership-contract.js";

const ZERO_SUBNETWORK = "0".repeat(40);
const STORAGE_MASS = "20000";

type Utxo = {
  outpoint: { transactionId: string; index: number };
  utxoEntry: {
    amount: string;
    scriptPublicKey: { scriptPublicKey: string };
    blockDaaScore: string;
    isCoinbase: boolean;
    covenantId?: string | null;
    covenant_id?: string | null;
  };
};

type PreparedOutput = {
  value: string;
  scriptPublicKey: string;
  covenant: { authorizingInput: number; covenantId: string } | null;
};

export class KaspaMembershipGateway implements MembershipGateway {
  constructor(private readonly api = "https://api-tn10.kaspa.org") {}

  async prepareOffer(creator: string): Promise<PreparedMembershipTransaction> {
    const state = minterState(creator);
    const [utxos, rate] = await Promise.all([this.utxos(creator), this.feeRate()]);
    const selected = selectWalletUtxos(utxos, creator, MEMBERSHIP_OUTPUT_VALUE, rate);
    const fee = estimatedFee(selected.length, rate, 1);
    const total = sumUtxos(selected);
    const redeemScript = membershipRedeemScript(state);
    const contractOutput = new TransactionOutput(
      MEMBERSHIP_OUTPUT_VALUE,
      payToScriptHashScript(redeemScript),
    );
    const id = covenantId(selected[0]!.outpoint, [{ index: 0, output: contractOutput }]).toString();
    const outputs: PreparedOutput[] = [{
      value: MEMBERSHIP_OUTPUT_VALUE.toString(),
      scriptPublicKey: membershipScript(state),
      covenant: { authorizingInput: 0, covenantId: id },
    }];
    const change = total - MEMBERSHIP_OUTPUT_VALUE - fee;
    if (change > 0n)
      outputs.push({ value: change.toString(), scriptPublicKey: addressScript(creator), covenant: null });
    return prepared(transaction(selected.map(walletInput), outputs, ""), id, selected.map((_, index) => index), null);
  }

  async prepareMint(creator: string, buyer: string, covenantIdHex: string): Promise<PreparedMembershipTransaction> {
    const minter = minterState(creator);
    const minterUtxos = await this.utxos(membershipAddress(minter));
    const minterUtxo = minterUtxos.find((utxo) => utxoCovenantId(utxo) === covenantIdHex);
    if (!minterUtxo) throw new Error("MEMBERSHIP_OFFER_UNAVAILABLE");
    const [{ virtualDaaScore }, buyerUtxos, rate] = await Promise.all([
      this.request<{ virtualDaaScore: string }>(`/info/blockdag?x=${Date.now()}`),
      this.utxos(buyer),
      this.feeRate(),
    ]);
    const selected = selectWalletUtxos(
      buyerUtxos,
      buyer,
      MEMBERSHIP_PRICE_SOMPI + MEMBERSHIP_OUTPUT_VALUE + MEMBERSHIP_INDEX_VALUE,
      rate,
    );
    const fee = estimatedFee(selected.length + 1, rate, 2);
    const total = sumUtxos(selected);
    if (total < MEMBERSHIP_PRICE_SOMPI + MEMBERSHIP_OUTPUT_VALUE + MEMBERSHIP_INDEX_VALUE + fee)
      throw new Error("INSUFFICIENT_FUNDS");
    const member: MembershipState = {
      creator: minter.creator,
      owner: addressPublicKey(buyer),
      expiresAtDaa: BigInt(virtualDaaScore) + MEMBERSHIP_DURATION_DAA,
      isMinter: false,
    };
    const covenant = { authorizingInput: 0, covenantId: covenantIdHex };
    const outputs: PreparedOutput[] = [
      { value: MEMBERSHIP_OUTPUT_VALUE.toString(), scriptPublicKey: membershipScript(minter), covenant },
      { value: MEMBERSHIP_OUTPUT_VALUE.toString(), scriptPublicKey: membershipScript(member), covenant },
      { value: MEMBERSHIP_PRICE_SOMPI.toString(), scriptPublicKey: addressScript(creator), covenant: null },
      { value: MEMBERSHIP_INDEX_VALUE.toString(), scriptPublicKey: addressScript(buyer), covenant: null },
    ];
    const change = total - MEMBERSHIP_PRICE_SOMPI - MEMBERSHIP_OUTPUT_VALUE - MEMBERSHIP_INDEX_VALUE - fee;
    if (change > 0n)
      outputs.push({ value: change.toString(), scriptPublicKey: addressScript(buyer), covenant: null });
    const minterInput = {
      transactionId: minterUtxo.outpoint.transactionId,
      index: minterUtxo.outpoint.index,
      sequence: "0",
      sigOpCount: 0,
      computeBudget: 50_000,
      signatureScript: membershipMintSignatureScript(
        membershipRedeemScript(minter),
        minter,
        member,
        1,
        2,
        3,
      ),
      utxo: serializableUtxo(minterUtxo, covenantIdHex),
    };
    const inputs = [minterInput, ...selected.map(walletInput)];
    return prepared(
      transaction(inputs, outputs, membershipPayload(membershipRedeemScript(member))),
      covenantIdHex,
      selected.map((_, index) => index + 1),
      1,
    );
  }

  async submit(preparedValue: PreparedMembershipTransaction, signedTransaction: string): Promise<PaymentSubmission> {
    let original: TransactionShape;
    let signed: TransactionShape;
    try {
      original = JSON.parse(preparedValue.transaction) as TransactionShape;
      signed = JSON.parse(signedTransaction) as TransactionShape;
    } catch {
      return rejected("INVALID_TRANSACTION");
    }
    if (digest(preparedValue.transaction) !== preparedValue.fingerprint)
      return rejected("INVALID_PREPARED_TEMPLATE");
    if (!sameTransaction(original, signed, preparedValue.signInputs))
      return rejected("PREPARED_TRANSACTION_CHANGED");
    if (!preparedValue.signInputs.every((index) => validSignature(signed.inputs[index]?.signatureScript)))
      return rejected("INVALID_SIGNATURES");
    const result = await this.request<{ transactionId?: string; error?: string }>("/transactions", {
      method: "POST",
      body: JSON.stringify({ transaction: submitTransaction(signed), allowOrphan: false }),
    });
    if (result.error || !result.transactionId)
      return rejected(result.error ?? "TRANSACTION_REJECTED", result.transactionId ?? null);
    const chain = await this.request<{ is_accepted?: boolean }>(`/transactions/${result.transactionId}`);
    return { isAccepted: chain.is_accepted ? true : null, transactionId: result.transactionId, rejection: null };
  }

  private utxos(address: string) {
    return this.request<Utxo[]>(`/addresses/${encodeURIComponent(address)}/utxos`);
  }

  private async feeRate() {
    const estimate = await this.request<{ normalBuckets: { feerate: number }[]; priorityBucket: { feerate: number } }>("/info/fee-estimate");
    return estimate.normalBuckets[0]?.feerate ?? estimate.priorityBucket.feerate;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.api}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
    if (!response.ok) throw new Error(`Kaspa request failed: ${response.status} ${await response.text()}`);
    return await response.json() as T;
  }
}

type TransactionInputShape = ReturnType<typeof walletInput>;
type TransactionShape = {
  id: string;
  version: number;
  inputs: TransactionInputShape[];
  outputs: PreparedOutput[];
  subnetworkId: string;
  lockTime: string;
  gas: string;
  storageMass: string;
  payload: string;
};

function minterState(creator: string): MembershipState {
  const publicKey = addressPublicKey(creator);
  return { creator: publicKey, owner: publicKey, expiresAtDaa: 0n, isMinter: true };
}

function selectWalletUtxos(utxos: Utxo[], address: string, amount: bigint, rate: number): Utxo[] {
  const selected: Utxo[] = [];
  let total = 0n;
  for (const utxo of [...utxos].sort((a, b) => Number(BigInt(b.utxoEntry.amount) - BigInt(a.utxoEntry.amount)))) {
    if (utxoCovenantId(utxo) || `0000${utxo.utxoEntry.scriptPublicKey.scriptPublicKey.replace(/^0000/, "")}` !== addressScript(address))
      continue;
    selected.push(utxo);
    total += BigInt(utxo.utxoEntry.amount);
    if (total >= amount + estimatedFee(selected.length, rate, 2)) return selected;
  }
  throw new Error("INSUFFICIENT_FUNDS");
}

function walletInput(utxo: Utxo) {
  return {
    transactionId: utxo.outpoint.transactionId,
    index: utxo.outpoint.index,
    sequence: "0",
    sigOpCount: 1,
    computeBudget: 0,
    signatureScript: "",
    utxo: serializableUtxo(utxo, null),
  };
}

function serializableUtxo(utxo: Utxo, covenantIdHex: string | null) {
  return {
    address: null,
    amount: utxo.utxoEntry.amount,
    scriptPublicKey: `0000${utxo.utxoEntry.scriptPublicKey.scriptPublicKey.replace(/^0000/, "")}`,
    blockDaaScore: utxo.utxoEntry.blockDaaScore,
    isCoinbase: utxo.utxoEntry.isCoinbase,
    covenantId: covenantIdHex,
  };
}

function transaction(inputs: TransactionInputShape[], outputs: PreparedOutput[], payload: string): string {
  return JSON.stringify({
    id: "0".repeat(64),
    version: 1,
    inputs,
    outputs,
    subnetworkId: ZERO_SUBNETWORK,
    lockTime: "0",
    gas: "0",
    storageMass: STORAGE_MASS,
    payload,
  });
}

function prepared(transactionJson: string, covenantIdHex: string, signInputs: number[], memberOutputIndex: number | null): PreparedMembershipTransaction {
  return {
    transaction: transactionJson,
    fingerprint: digest(transactionJson),
    covenantId: covenantIdHex,
    signInputs,
    memberOutputIndex,
  };
}

function sameTransaction(original: TransactionShape, signed: TransactionShape, signInputs: number[]): boolean {
  const normalize = (value: TransactionShape) => ({
    ...value,
    id: "",
    inputs: value.inputs.map((input, index) => ({
      ...input,
      signatureScript: signInputs.includes(index) ? "" : input.signatureScript,
    })),
  });
  return canonical(normalize(original)) === canonical(normalize(signed));
}

function submitTransaction(value: TransactionShape) {
  return {
    version: value.version,
    inputs: value.inputs.map((input) => ({
      previousOutpoint: { transactionId: input.transactionId, index: input.index },
      signatureScript: input.signatureScript,
      sequence: Number(input.sequence),
      sigOpCount: input.sigOpCount,
    })),
    outputs: value.outputs.map((output) => ({
      amount: Number(output.value),
      scriptPublicKey: {
        version: Number.parseInt(output.scriptPublicKey.slice(0, 4), 16),
        scriptPublicKey: output.scriptPublicKey.slice(4),
      },
      ...(output.covenant ? { covenant: output.covenant } : {}),
    })),
    lockTime: Number(value.lockTime),
    subnetworkId: value.subnetworkId,
    gas: Number(value.gas),
    payload: value.payload,
  };
}

function utxoCovenantId(utxo: Utxo): string | null {
  return utxo.utxoEntry.covenantId ?? utxo.utxoEntry.covenant_id ?? null;
}

function sumUtxos(values: Utxo[]): bigint {
  return values.reduce((sum, value) => sum + BigInt(value.utxoEntry.amount), 0n);
}

function estimatedFee(inputs: number, rate: number, covenantOutputs: number): bigint {
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("INVALID_FEE_RATE");
  return BigInt(Math.ceil((4_000 + 1_500 * inputs + 500 * covenantOutputs) * rate));
}

function validSignature(value: string | undefined): boolean {
  return typeof value === "string" && /^[0-9a-f]+$/i.test(value) && value.length % 2 === 0 && value.endsWith("01");
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function rejected(rejection: string, transactionId: string | null = null): PaymentSubmission {
  return { isAccepted: false, transactionId, rejection };
}
