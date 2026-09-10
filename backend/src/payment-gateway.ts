import { createHash } from "node:crypto";
import type { PaymentGateway, PaymentSubmission, Post, PreparedPayment } from "./domain.js";

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const ZERO_SUBNETWORK = "0".repeat(40);
type Utxo = { outpoint: { transactionId: string; index: number }; utxoEntry: { amount: string; scriptPublicKey: { scriptPublicKey: string }; blockDaaScore: string; isCoinbase: boolean } };
type ChainTransaction = { is_accepted?: boolean; inputs?: { previous_outpoint_resolved?: { script_public_key_address?: string } }[]; outputs?: { amount?: string | number; script_public_key_address?: string }[] };

export class KaspaPaymentGateway implements PaymentGateway {
  constructor(private readonly api = "https://api-tn10.kaspa.org") {}

  async prepare(post: Post, buyer: string): Promise<PreparedPayment> {
    const [utxos, estimate] = await Promise.all([
      this.request<Utxo[]>(`/addresses/${encodeURIComponent(buyer)}/utxos`),
      this.request<{ normalBuckets: { feerate: number }[]; priorityBucket: { feerate: number } }>("/info/fee-estimate"),
    ]);
    const amount = BigInt(post.priceSompi);
    const rate = estimate.normalBuckets[0]?.feerate ?? estimate.priorityBucket.feerate;
    const buyerScript = scriptFor(buyer);
    const selected: Utxo[] = [];
    let total = 0n;
    for (const utxo of [...utxos].sort((a, b) => Number(BigInt(b.utxoEntry.amount) - BigInt(a.utxoEntry.amount)))) {
      if (`0000${utxo.utxoEntry.scriptPublicKey.scriptPublicKey}` !== buyerScript) continue;
      selected.push(utxo);
      total += BigInt(utxo.utxoEntry.amount);
      if (total >= amount + estimatedFee(selected.length, rate)) break;
    }
    const fee = estimatedFee(selected.length, rate);
    if (total < amount + fee) throw new Error("INSUFFICIENT_FUNDS");
    const outputs = [{ value: amount.toString(), scriptPublicKey: scriptFor(post.creator), covenant: null }];
    const change = total - amount - fee;
    if (change > 0n) outputs.push({ value: change.toString(), scriptPublicKey: buyerScript, covenant: null });
    const transaction = JSON.stringify({ id: "0".repeat(64), version: 0, inputs: selected.map((utxo) => ({ transactionId: utxo.outpoint.transactionId, index: utxo.outpoint.index, sequence: "0", sigOpCount: 1, computeBudget: 0, signatureScript: "", utxo: { amount: utxo.utxoEntry.amount, scriptPublicKey: `0000${utxo.utxoEntry.scriptPublicKey.scriptPublicKey}`, blockDaaScore: utxo.utxoEntry.blockDaaScore, isCoinbase: utxo.utxoEntry.isCoinbase } })), outputs, subnetworkId: ZERO_SUBNETWORK, lockTime: "0", gas: "0", storageMass: "20000", payload: "" });
    return { transaction, fingerprint: digest(transaction), amountSompi: post.priceSompi, creator: post.creator };
  }

  async submit(prepared: PreparedPayment, signedTransaction: string): Promise<PaymentSubmission> {
    let signed: Record<string, unknown>;
    try { signed = JSON.parse(signedTransaction) as Record<string, unknown>; } catch { return rejected("INVALID_TRANSACTION"); }
    const original = JSON.parse(prepared.transaction) as Record<string, unknown>;
    if (!isTransactionShape(original) || !isTransactionShape(signed)) return rejected("INVALID_TRANSACTION");
    if (digest(prepared.transaction) !== prepared.fingerprint) return rejected("INVALID_PREPARED_TEMPLATE");
    if (!sameTransaction(original, signed)) return rejected("PREPARED_TRANSACTION_CHANGED");
    if (!hasAllSignatures(signed)) return rejected("INVALID_SIGNATURES");
    await this.validateInputs(signed);
    const result = await this.request<{ transactionId?: string; error?: string }>("/transactions", { method: "POST", body: JSON.stringify({ transaction: toSubmitTransaction(signed), allowOrphan: false }) });
    if (result.error || !result.transactionId) return rejected(result.error ?? "TRANSACTION_REJECTED", result.transactionId ?? null);
    return this.status(result.transactionId);
  }

  async status(transactionId: string): Promise<PaymentSubmission> {
    const value = await this.request<{ is_accepted: boolean }>(`/transactions/${transactionId}`);
    return { isAccepted: value.is_accepted ? true : null, transactionId, rejection: null };
  }

  async verifyPurchase(transactionId: string, buyer: string, creator: string, amountSompi: string): Promise<boolean> {
    let tx: ChainTransaction;
    try {
      tx = await this.request<ChainTransaction>(
        `/transactions/${transactionId}?inputs=true&outputs=true&resolve_previous_outpoints=full`,
      );
    } catch (error) {
      if (error instanceof KaspaRequestError && error.status === 404) return false;
      throw error;
    }
    if (!tx.is_accepted || !tx.inputs?.length || !tx.outputs?.length) return false;
    if (!tx.inputs.every((input) => input.previous_outpoint_resolved?.script_public_key_address === buyer)) return false;
    return tx.outputs.some((output) => String(output.amount) === amountSompi && output.script_public_key_address === creator);
  }

  private async validateInputs(transaction: Record<string, unknown>) {
    for (const input of transaction.inputs as Record<string, unknown>[]) {
      const id = input.transactionId; const index = input.index;
      if (typeof id !== "string" || !/^[0-9a-f]{64}$/i.test(id) || typeof index !== "number" || !Number.isInteger(index) || index < 0) throw new Error("INVALID_INPUT");
      const parent = await this.request<{ outputs?: { amount: string | number; script_public_key: string | { script_public_key?: string; scriptPublicKey?: string } }[] }>(`/transactions/${id}`);
      const output = parent.outputs?.[index]; const utxo = input.utxo as Record<string, unknown> | undefined;
      const script = typeof output?.script_public_key === "string" ? output.script_public_key : output?.script_public_key?.script_public_key ?? output?.script_public_key?.scriptPublicKey;
      if (!output || !utxo || String(output.amount) !== String(utxo.amount) || !script || `0000${script.replace(/^0000/, "")}` !== utxo.scriptPublicKey) throw new Error("INPUT_CHANGED");
    }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.api}${path}`, { headers: { "Content-Type": "application/json" }, ...init });
    if (!response.ok) throw new KaspaRequestError(response.status, await response.text());
    return await response.json() as T;
  }
}

class KaspaRequestError extends Error {
  constructor(readonly status: number, body: string) {
    super(`Kaspa request failed: ${status} ${body}`);
  }
}

function scriptFor(address: string): string { const data = address.slice(address.lastIndexOf(":") + 1, -8).split("").map((char) => CHARSET.indexOf(char)); const bytes: number[] = []; let buffer = 0n; let bits = 0; for (const value of data) { buffer = (buffer << 5n) | BigInt(value); bits += 5; while (bits >= 8) { bits -= 8; bytes.push(Number((buffer >> BigInt(bits)) & 255n)); buffer &= (1n << BigInt(bits)) - 1n; } } if (bytes[0] !== 0 || bytes.length !== 33) throw new Error("INVALID_CREATOR_ADDRESS"); return `000020${bytes.slice(1).map((byte) => byte.toString(16).padStart(2, "0")).join("")}ac`; }
function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }
function estimatedFee(inputs: number, rate: number) { if (!Number.isFinite(rate) || rate <= 0) throw new Error("INVALID_FEE_RATE"); return BigInt(Math.ceil((2036 + 1000 * inputs) * rate)); }
function rejected(rejection: string, transactionId: string | null = null): PaymentSubmission { return { isAccepted: false, transactionId, rejection }; }
function hasAllSignatures(transaction: Record<string, unknown>) { return Array.isArray(transaction.inputs) && transaction.inputs.length > 0 && transaction.inputs.every((input) => { const signature = (input as Record<string, unknown>).signatureScript; return typeof signature === "string" && signature.length > 0 && signature.length % 2 === 0 && /^[0-9a-f]+$/i.test(signature) && signature.endsWith("01"); }); }
function isTransactionShape(transaction: Record<string, unknown>) { return transaction.version === 0 && Array.isArray(transaction.inputs) && transaction.inputs.length > 0 && Array.isArray(transaction.outputs) && transaction.outputs.length > 0 && typeof transaction.subnetworkId === "string" && typeof transaction.lockTime === "string" && typeof transaction.gas === "string" && typeof transaction.storageMass === "string" && typeof transaction.payload === "string"; }
function sameTransaction(original: Record<string, unknown>, signed: Record<string, unknown>) { const keys = ["version", "outputs", "subnetworkId", "lockTime", "gas", "storageMass", "payload"]; if (!keys.every((key) => JSON.stringify(original[key]) === JSON.stringify(signed[key]))) return false; const normalize = (value: unknown) => (value as Record<string, unknown>[]).map((input) => { const utxo = input.utxo as Record<string, unknown>; return { transactionId: input.transactionId, index: input.index, sequence: input.sequence, sigOpCount: input.sigOpCount, computeBudget: input.computeBudget ?? 0, utxo: { amount: utxo.amount, scriptPublicKey: utxo.scriptPublicKey, blockDaaScore: utxo.blockDaaScore, isCoinbase: utxo.isCoinbase } }; }); return JSON.stringify(normalize(original.inputs)) === JSON.stringify(normalize(signed.inputs)); }
function toSubmitTransaction(transaction: Record<string, unknown>) { return { version: transaction.version, inputs: (transaction.inputs as Record<string, unknown>[]).map((input) => ({ previousOutpoint: { transactionId: input.transactionId, index: input.index }, signatureScript: input.signatureScript, sequence: Number(input.sequence), sigOpCount: input.sigOpCount })), outputs: (transaction.outputs as Record<string, unknown>[]).map((output) => ({ amount: Number(output.value), scriptPublicKey: { version: parseInt(String(output.scriptPublicKey).slice(0, 4), 16), scriptPublicKey: String(output.scriptPublicKey).slice(4) } })), lockTime: Number(transaction.lockTime), subnetworkId: transaction.subnetworkId }; }
