import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  covenantId,
  createInputSignature,
  Encoding,
  Mnemonic,
  payToScriptHashScript,
  Resolver,
  RpcClient,
  SighashType,
  Transaction,
  TransactionOutput,
  updateTransactionMass,
  XPrv,
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
import { logger as defaultLogger, safeError, type Logger } from "./observability.js";

const ZERO_SUBNETWORK = "0".repeat(40);
const WALLET_COMPUTE_BUDGET = 50;
const COVENANT_COMPUTE_BUDGET = 50;
const NETWORK_ID = "testnet-10";
const CONNECT_TIMEOUT_MS = 10_000;
const CONNECT_RETRY_INTERVAL_MS = 1_000;
const CONFIRM_MAX_ATTEMPTS = 9;
const CONFIRM_BASE_DELAY_MS = 1_000;
const CONFIRM_MAX_DELAY_MS = 16_000;

type MembershipTransactionRelay = (signedTransaction: string) => Promise<string>;
type Sleep = (milliseconds: number) => Promise<void>;
type MembershipRpcClient = Pick<RpcClient, "connect" | "disconnect" | "submitTransaction">;
type MembershipRpcClientFactory = () => MembershipRpcClient;

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

type ChainOutput = {
  amount?: string | number;
  script_public_key?: string;
  covenant_id?: string;
  covenantId?: string;
  covenant_authorizing_input?: number;
  covenant?: {
    covenant_id?: string;
    covenantId?: string;
    authorizing_input?: number;
    authorizingInput?: number;
  } | null;
};

type ChainTransaction = {
  version?: number;
  is_accepted?: boolean;
  outputs?: ChainOutput[];
};

export class KaspaMembershipGateway implements MembershipGateway {
  constructor(
    private readonly api = "https://api-tn10.kaspa.org",
    private readonly relay: MembershipTransactionRelay = submitMembershipTransactionOverWrpc,
    private readonly sleep: Sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    private readonly logger: Logger = defaultLogger,
  ) {}

  async prepareOffer(creator: string): Promise<PreparedMembershipTransaction> {
    const state = minterState(creator);
    const [utxos, rate] = await Promise.all([this.utxos(creator), this.feeRate()]);
    const redeemScript = membershipRedeemScript(state);
    const contractOutput = new TransactionOutput(
      MEMBERSHIP_OUTPUT_VALUE,
      payToScriptHashScript(redeemScript),
    );
    const provisionalOutputs: PreparedOutput[] = [
      {
        value: MEMBERSHIP_OUTPUT_VALUE.toString(),
        scriptPublicKey: membershipScript(state),
        covenant: { authorizingInput: 0, covenantId: "0".repeat(64) },
      },
      { value: "0", scriptPublicKey: addressScript(creator), covenant: null },
    ];
    const selected = selectWalletUtxos(
      utxos,
      creator,
      MEMBERSHIP_OUTPUT_VALUE,
      (values) => estimatedFee(values.map(walletInput), provisionalOutputs, rate),
    );
    const fee = estimatedFee(selected.map(walletInput), provisionalOutputs, rate);
    const total = sumUtxos(selected);
    const id = covenantId(selected[0]!.outpoint, [{ index: 0, output: contractOutput }]).toString();
    const outputs: PreparedOutput[] = [{
      value: MEMBERSHIP_OUTPUT_VALUE.toString(),
      scriptPublicKey: membershipScript(state),
      covenant: { authorizingInput: 0, covenantId: id },
    }];
    const change = total - MEMBERSHIP_OUTPUT_VALUE - fee;
    if (change > 0n)
      outputs.push({ value: change.toString(), scriptPublicKey: addressScript(creator), covenant: null });
    const result = prepared(transaction(selected.map(walletInput), outputs, ""), id, selected.map((_, index) => index), null);
    this.logger.debug("membership_transaction_prepared", {
      kind: "offer",
      inputCount: selected.length,
      outputCount: outputs.length,
      signInputs: result.signInputs,
      covenantIdPrefix: id.slice(0, 12),
      templateSummary: transactionSummary(result.transaction),
    });
    return result;
  }

  async prepareMint(creator: string, buyer: string, covenantIdHex: string): Promise<PreparedMembershipTransaction> {
    const minter = minterState(creator);
    const minterUtxos = await this.utxos(membershipAddress(minter));
    const minterUtxo = await this.findMinterUtxo(minterUtxos, minter, covenantIdHex);
    if (!minterUtxo) throw new Error("MEMBERSHIP_OFFER_UNAVAILABLE");
    const [{ virtualDaaScore }, buyerUtxos, rate] = await Promise.all([
      this.request<{ virtualDaaScore: string }>(`/info/blockdag?x=${Date.now()}`),
      this.utxos(buyer),
      this.feeRate(),
    ]);
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
    const minterInput = {
      transactionId: minterUtxo.outpoint.transactionId,
      index: minterUtxo.outpoint.index,
      sequence: "0",
      sigOpCount: 0,
      computeBudget: COVENANT_COMPUTE_BUDGET,
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
    const payload = membershipPayload(membershipRedeemScript(member));
    const provisionalOutputs = [
      ...outputs,
      { value: "0", scriptPublicKey: addressScript(buyer), covenant: null },
    ];
    const selected = selectWalletUtxos(
      buyerUtxos,
      buyer,
      MEMBERSHIP_PRICE_SOMPI + MEMBERSHIP_OUTPUT_VALUE + MEMBERSHIP_INDEX_VALUE,
      (values) => estimatedFee([minterInput, ...values.map(walletInput)], provisionalOutputs, rate, payload),
    );
    const inputs = [minterInput, ...selected.map(walletInput)];
    const fee = estimatedFee(inputs, provisionalOutputs, rate, payload);
    const total = sumUtxos(selected);
    const change = total - MEMBERSHIP_PRICE_SOMPI - MEMBERSHIP_OUTPUT_VALUE - MEMBERSHIP_INDEX_VALUE - fee;
    if (change > 0n)
      outputs.push({ value: change.toString(), scriptPublicKey: addressScript(buyer), covenant: null });
    const result = prepared(
      transaction(inputs, outputs, payload, virtualDaaScore),
      covenantIdHex,
      selected.map((_, index) => index + 1),
      1,
    );
    try {
      this.logger.debug("membership_preflight", {
        kind: "purchase",
        checks: membershipPreflight(creator, buyer, minter, member, inputs, outputs, virtualDaaScore),
      });
    } catch {
      // Diagnostics must never affect transaction preparation or submission.
    }
    this.logger.debug("membership_transaction_prepared", {
      kind: "purchase",
      inputCount: inputs.length,
      outputCount: outputs.length,
      signInputs: result.signInputs,
      covenantIdPrefix: covenantIdHex.slice(0, 12),
      templateSummary: transactionSummary(result.transaction),
    });
    return result;
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
    this.logger.debug("membership_transaction_signed", {
      signInputs: preparedValue.signInputs,
      signedSummary: transactionSummary(signedTransaction),
      sigDiagnostics: signatureSummary(signed, preparedValue.signInputs),
    });
    let transactionId: string;
    try {
      transactionId = await this.relay(signedTransaction);
    } catch (error) {
      this.logger.error("membership_transaction_relay_failed", {
        signInputs: preparedValue.signInputs,
        signedSummary: transactionSummary(signedTransaction),
        error: safeError(error),
        walletSigCheck: await testWalletSignatureDiagnostic(signedTransaction),
      });
      throw error;
    }
    this.logger.info("membership_transaction_relayed", {
      txIdPrefix: transactionId.slice(0, 12),
    });
    const chain = await this.waitForTransaction(transactionId);
    if (!chain) {
      this.logger.warn("membership_transaction_confirmation_timeout", {
        txIdPrefix: transactionId.slice(0, 12),
      });
      throw new Error(`Transaction ${transactionId} was not confirmed on chain`);
    }
    this.logger.info("membership_transaction_confirmed", {
      txIdPrefix: transactionId.slice(0, 12),
      accepted: chain.is_accepted === true,
    });
    return { isAccepted: chain.is_accepted ? true : null, transactionId, rejection: null };
  }

  private async waitForTransaction(transactionId: string): Promise<{ is_accepted?: boolean } | null> {
    let delay = CONFIRM_BASE_DELAY_MS;
    for (let attempt = 0; attempt <= CONFIRM_MAX_ATTEMPTS; attempt++) {
      const transaction = await this.transaction(transactionId);
      if (transaction) return transaction;
      if (attempt < CONFIRM_MAX_ATTEMPTS) {
        await this.sleep(delay);
        delay = Math.min(delay * 2, CONFIRM_MAX_DELAY_MS);
      }
    }
    return null;
  }

  private async transaction(transactionId: string): Promise<{ is_accepted?: boolean } | null> {
    const response = await fetch(`${this.api}/transactions/${transactionId.toLowerCase()}`, {
      headers: { "Content-Type": "application/json" },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Kaspa request failed: ${response.status} ${await response.text()}`);
    return await response.json() as { is_accepted?: boolean };
  }

  private utxos(address: string) {
    return this.request<Utxo[]>(`/addresses/${encodeURIComponent(address)}/utxos`);
  }

  private async findMinterUtxo(
    utxos: Utxo[],
    minter: MembershipState,
    covenantIdHex: string,
  ): Promise<Utxo | undefined> {
    const expectedScript = membershipScript(minter).slice(4);
    const candidates = utxos.filter((utxo) =>
      BigInt(utxo.utxoEntry.amount) === MEMBERSHIP_OUTPUT_VALUE
      && utxo.utxoEntry.scriptPublicKey.scriptPublicKey === expectedScript,
    );
    const matches = await Promise.all(candidates.map(async (utxo) => {
      const transaction = await this.request<ChainTransaction>(`/transactions/${utxo.outpoint.transactionId}`);
      const output = transaction.outputs?.[utxo.outpoint.index];
      return transaction.version === 1
        && transaction.is_accepted === true
        && outputAmount(output) === MEMBERSHIP_OUTPUT_VALUE
        && output?.script_public_key === expectedScript
        && outputCovenantId(output) === covenantIdHex
        && outputAuthorizingInput(output) === 0
        ? utxo
        : undefined;
    }));
    return matches.find((utxo) => utxo !== undefined);
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

export async function submitMembershipTransactionOverWrpc(
  signedTransaction: string,
  createClient: MembershipRpcClientFactory = () => new RpcClient({
    resolver: new Resolver(),
    networkId: NETWORK_ID,
    encoding: Encoding.Borsh,
  }),
): Promise<string> {
  const transaction = Transaction.deserializeFromSafeJSON(signedTransaction);
  const rpc = createClient();
  try {
    await rpc.connect({
      timeoutDuration: CONNECT_TIMEOUT_MS,
      retryInterval: CONNECT_RETRY_INTERVAL_MS,
    });
    const result = await rpc.submitTransaction({ transaction, allowOrphan: false });
    return result.transactionId;
  } finally {
    await rpc.disconnect();
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

function selectWalletUtxos(
  utxos: Utxo[],
  address: string,
  amount: bigint,
  feeFor: (selected: Utxo[]) => bigint,
): Utxo[] {
  const selected: Utxo[] = [];
  let total = 0n;
  for (const utxo of [...utxos].sort((a, b) => Number(BigInt(b.utxoEntry.amount) - BigInt(a.utxoEntry.amount)))) {
    if (utxoCovenantId(utxo) || `0000${utxo.utxoEntry.scriptPublicKey.scriptPublicKey.replace(/^0000/, "")}` !== addressScript(address))
      continue;
    selected.push(utxo);
    total += BigInt(utxo.utxoEntry.amount);
    if (total >= amount + feeFor(selected)) return selected;
  }
  throw new Error("INSUFFICIENT_FUNDS");
}

function walletInput(utxo: Utxo) {
  return {
    transactionId: utxo.outpoint.transactionId,
    index: utxo.outpoint.index,
    sequence: "0",
    sigOpCount: 0,
    computeBudget: WALLET_COMPUTE_BUDGET,
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

function transaction(inputs: TransactionInputShape[], outputs: PreparedOutput[], payload: string, lockTime = "0"): string {
  const value = Transaction.deserializeFromSafeJSON(JSON.stringify({
    id: "0".repeat(64),
    version: 1,
    inputs,
    outputs,
    subnetworkId: ZERO_SUBNETWORK,
    lockTime,
    gas: "0",
    storageMass: "0",
    payload,
  }));
  if (!updateTransactionMass(NETWORK_ID, value, 1, true))
    throw new Error("TRANSACTION_MASS_TOO_HIGH");
  return value.serializeToSafeJSON();
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

function sumUtxos(values: Utxo[]): bigint {
  return values.reduce((sum, value) => sum + BigInt(value.utxoEntry.amount), 0n);
}

function utxoCovenantId(utxo: Utxo): string | null {
  return utxo.utxoEntry.covenantId ?? utxo.utxoEntry.covenant_id ?? null;
}

function outputAmount(output: ChainOutput | undefined): bigint | null {
  const value = output?.amount;
  if (typeof value !== "string" && typeof value !== "number") return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function outputCovenantId(output: ChainOutput | undefined): string | null {
  return output?.covenant_id
    ?? output?.covenantId
    ?? output?.covenant?.covenant_id
    ?? output?.covenant?.covenantId
    ?? null;
}

function outputAuthorizingInput(output: ChainOutput | undefined): number | null {
  return output?.covenant_authorizing_input
    ?? output?.covenant?.authorizing_input
    ?? output?.covenant?.authorizingInput
    ?? null;
}

function estimatedFee(inputs: TransactionInputShape[], outputs: PreparedOutput[], rate: number, payload = ""): bigint {
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("INVALID_FEE_RATE");
  const inputSize = inputs.reduce((sum, input) => {
    const signatureBytes = input.signatureScript.length > 0 ? input.signatureScript.length / 2 : 66;
    return sum + 32 + 4 + 8 + signatureBytes + 8 + 2;
  }, 0);
  const outputSize = outputs.reduce(
    (sum, output) => sum + 8 + 2 + 8 + (output.scriptPublicKey.length - 4) / 2 + (output.covenant ? 34 : 0),
    0,
  );
  const transactionSize = 2 + 8 + inputSize + 8 + outputSize + 8 + 20 + 8 + 32 + 8 + payload.length / 2;
  const scriptPublicKeyMass = 10 * outputs.reduce(
    (sum, output) => sum + 2 + (output.scriptPublicKey.length - 4) / 2,
    0,
  );
  const computeBudgetMass = 100 * inputs.reduce((sum, input) => sum + input.computeBudget, 0);
  const computeMass = transactionSize + scriptPublicKeyMass + computeBudgetMass;
  const estimated = BigInt(Math.ceil(computeMass * rate));
  const relayFloor = 100n * BigInt(computeMass);
  return estimated > relayFloor ? estimated : relayFloor;
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

function transactionSummary(value: string): Record<string, unknown> {
  try {
    const transaction = JSON.parse(value) as TransactionShape;
    return {
      version: transaction.version,
      lockTime: transaction.lockTime,
      inputCount: transaction.inputs.length,
      outputCount: transaction.outputs.length,
      inputs: transaction.inputs.map((input) => ({
        index: input.index,
        outpointPrefix: input.transactionId.slice(0, 12),
        sigOpCount: input.sigOpCount,
        computeBudget: input.computeBudget,
        sigLen: input.signatureScript.length,
        sigTail: input.signatureScript.slice(-8),
        hasCovenantId: Boolean(input.utxo?.covenantId),
      })),
      outputs: transaction.outputs.map((output, index) => ({
        index,
        value: output.value,
        scriptLength: output.scriptPublicKey.length,
        hasCovenant: Boolean(output.covenant),
      })),
      dataLen: transaction.payload.length,
    };
  } catch {
    return { invalidJson: true };
  }
}

function signatureSummary(transaction: TransactionShape, signInputs: number[]) {
  return signInputs.map((index) => {
    const signature = transaction.inputs[index]?.signatureScript ?? "";
    return {
      inputIndex: index,
      length: signature.length,
      tail: signature.slice(-8),
      validShape: validSignature(signature),
    };
  });
}

async function testWalletSignatureDiagnostic(signedTransaction: string): Promise<Record<string, unknown>> {
  if (process.env.NODE_ENV === "production") return { enabled: false };
  try {
    const fixture = JSON.parse(
      await readFile(new URL("../../wallet-testnet.json", import.meta.url), "utf8"),
    ) as { kasware?: { wallets?: { name: string; seedPhrase: string }[] } };
    const transaction = Transaction.deserializeFromSafeJSON(signedTransaction);
    const input = transaction.inputs[1];
    const inputScriptValue = input?.utxo?.scriptPublicKey;
    const inputScript = typeof inputScriptValue === "string"
      ? inputScriptValue
      : inputScriptValue
        ? `${inputScriptValue.version.toString(16).padStart(4, "0")}${inputScriptValue.script}`
        : undefined;
    if (!input || !inputScript) return { enabled: true, matchedAddress: false };
    for (const wallet of fixture.kasware?.wallets ?? []) {
      const privateKey = new XPrv(new Mnemonic(wallet.seedPhrase).toSeed())
        .derivePath("m/44'/111111'/0'/0/0")
        .toPrivateKey();
      const keypair = privateKey.toKeypair();
      const addressScriptHex = addressScript(keypair.toAddress("testnet-10").toString());
      if (addressScriptHex !== inputScript) continue;
      const sdkSignature = createInputSignature(transaction, 1, privateKey, SighashType.All);
      return {
        enabled: true,
        walletName: wallet.name,
        matchedAddress: true,
        sdkLen: sdkSignature.length,
        kaswareLen: input.signatureScript?.length ?? 0,
        exactMatch: sdkSignature === input.signatureScript,
        sdkHex: sdkSignature,
        kaswareHex: input.signatureScript,
      };
    }
    return { enabled: true, matchedAddress: false };
  } catch (error) {
    return { enabled: true, diagnosticError: error instanceof Error ? error.name : typeof error };
  }
}

function membershipPreflight(
  creator: string,
  buyer: string,
  minter: MembershipState,
  member: MembershipState,
  inputs: TransactionInputShape[],
  outputs: PreparedOutput[],
  daa: string,
) {
  const creatorLock = addressScript(creator);
  const buyerLock = addressScript(buyer);
  const minterOutput = outputs[0];
  const memberOutput = outputs[1];
  const paymentOutput = outputs[2];
  const ownerOutput = outputs[3];
  const fundingInput = inputs[1];
  const memberExpiry = member.expiresAtDaa;
  const currentDaa = BigInt(daa);
  return {
    previousIsMinter: { pass: minter.isMinter, actual: minter.isMinter },
    memberCreatorMatches: { pass: member.creator === minter.creator },
    memberIsNotMinter: { pass: !member.isMinter, actual: member.isMinter },
    memberExpiryWindow: {
      pass: currentDaa >= memberExpiry - MEMBERSHIP_DURATION_DAA,
      currentDaa: daa,
      minimumDaa: (memberExpiry - MEMBERSHIP_DURATION_DAA).toString(),
    },
    membershipOutputValue: {
      pass: memberOutput?.value === MEMBERSHIP_OUTPUT_VALUE.toString(),
      actual: memberOutput?.value,
      expected: MEMBERSHIP_OUTPUT_VALUE.toString(),
    },
    fundingInputUsesBuyerLock: {
      pass: fundingInput?.utxo.scriptPublicKey === buyerLock,
    },
    ownerOutputUsesBuyerLock: {
      pass: ownerOutput?.scriptPublicKey === buyerLock,
      actualScriptLength: ownerOutput?.scriptPublicKey.length,
      expectedScriptLength: buyerLock.length,
    },
    ownerOutputValue: {
      pass: ownerOutput?.value === MEMBERSHIP_INDEX_VALUE.toString(),
      actual: ownerOutput?.value,
      expected: MEMBERSHIP_INDEX_VALUE.toString(),
    },
    paymentOutputUsesCreatorLock: {
      pass: paymentOutput?.scriptPublicKey === creatorLock,
      actualScriptLength: paymentOutput?.scriptPublicKey.length,
      expectedScriptLength: creatorLock.length,
    },
    paymentOutputValue: {
      pass: paymentOutput?.value === MEMBERSHIP_PRICE_SOMPI.toString(),
      actual: paymentOutput?.value,
      expected: MEMBERSHIP_PRICE_SOMPI.toString(),
    },
    minterOutputPresent: { pass: Boolean(minterOutput?.covenant) },
    memberOutputPresent: { pass: Boolean(memberOutput?.covenant) },
    minterOutputScript: {
      pass: minterOutput?.scriptPublicKey === membershipScript(minter),
    },
    memberOutputScript: {
      pass: memberOutput?.scriptPublicKey === membershipScript(member),
    },
    covenantAuthorizingInput: {
      pass: minterOutput?.covenant?.authorizingInput === 0
        && memberOutput?.covenant?.authorizingInput === 0,
      minter: minterOutput?.covenant?.authorizingInput,
      member: memberOutput?.covenant?.authorizingInput,
    },
  };
}

function rejected(rejection: string, transactionId: string | null = null): PaymentSubmission {
  return { isAccepted: false, transactionId, rejection };
}
