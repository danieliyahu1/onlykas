import type { MembershipCheck, MembershipVerifier } from "./domain.js";
import { XOnlyPublicKey } from "@kluster/kaspa-wasm";
import { logger as defaultLogger, type Logger } from "./observability.js";
import {
  addressPublicKey,
  addressScript,
  decodeMembershipRedeemScript,
  MEMBERSHIP_DURATION_DAA,
  MEMBERSHIP_INDEX_VALUE,
  MEMBERSHIP_OUTPUT_VALUE,
  MEMBERSHIP_PRICE_SOMPI,
  membershipAddress,
  membershipScript,
  parseMembershipPayload,
} from "./membership-contract.js";

const DAA_MILLISECONDS = 100;

type VerifierUtxo = {
  outpoint: { transactionId: string; index: number };
  utxoEntry: {
    amount: string;
    blockDaaScore?: string;
  };
};

type ChainCovenant = {
  covenant_id?: string;
  covenantId?: string;
  authorizing_input?: number;
  authorizingInput?: number;
};

type ChainOutput = {
  amount?: string | number;
  value?: string | number;
  script_public_key?: string | { script_public_key?: string; scriptPublicKey?: string };
  scriptPublicKey?: string | { script?: string };
  script_public_key_address?: string;
  covenant_id?: string;
  covenantId?: string;
  covenant_authorizing_input?: number;
  authorizing_input?: number;
  covenant?: ChainCovenant | null;
};

type ChainTransaction = {
  version?: number;
  is_accepted?: boolean;
  payload?: string;
  outputs?: ChainOutput[];
};

export class KaspaMembershipVerifier implements MembershipVerifier {
  constructor(
    private readonly api = "https://api-tn10.kaspa.org",
    private readonly now: () => number = Date.now,
    private readonly logger: Logger = defaultLogger,
  ) {}

  async verifyAddress(
    address: string,
    expectedOwner?: string,
    expectedCovenantId?: string,
    expectedCreator?: string,
  ): Promise<MembershipCheck[]> {
    const [utxos, currentDaa] = await Promise.all([this.utxos(address), this.currentDaa()]);
    const pointers = utxos.filter((utxo) => bigintOrNull(utxo.utxoEntry.amount) === MEMBERSHIP_INDEX_VALUE);
    return Promise.all(pointers.map(async (pointer) => {
      const transaction = await this.transaction(pointer.outpoint.transactionId);
      return this.checkMemberOutput(
        pointer.outpoint.transactionId,
        1,
        transaction,
        currentDaa,
        expectedOwner ?? address,
        expectedCovenantId,
        expectedCreator,
      );
    }));
  }

  async verifyUtxo(
    transactionId: string,
    outputIndex: number,
    expectedOwner?: string,
    expectedCovenantId?: string,
    expectedCreator?: string,
  ): Promise<MembershipCheck> {
    const [transaction, currentDaa] = await Promise.all([
      this.transaction(transactionId),
      this.currentDaa(),
    ]);
    return this.checkMemberOutput(
      transactionId,
      outputIndex,
      transaction,
      currentDaa,
      expectedOwner,
      expectedCovenantId,
      expectedCreator,
    );
  }

  private async checkMemberOutput(
    transactionId: string,
    outputIndex: number,
    transaction: ChainTransaction,
    currentDaa: bigint,
    expectedOwner?: string,
    expectedCovenantId?: string,
    expectedCreator?: string,
  ): Promise<MembershipCheck> {
    const output = transaction.outputs?.[outputIndex];
    const covenantId = outputCovenantId(output);
    const redeemScript = parseMembershipPayload(transaction.payload);
    const state = redeemScript ? decodeMembershipRedeemScript(redeemScript) : null;
    if (
      !transaction.is_accepted ||
      transaction.version !== 1 ||
      outputIndex !== 1 ||
      !output ||
      !covenantId ||
      !state ||
      state.isMinter ||
      outputAmount(output) !== MEMBERSHIP_OUTPUT_VALUE ||
      outputScript(output) !== membershipScript(state) ||
      outputAuthorizingInput(output) !== 0 ||
      (expectedCovenantId !== undefined && covenantId !== expectedCovenantId)
    ) return notMembership(transactionId, outputIndex, covenantId);

    const owner = expectedOwner ?? keyAddress(state.owner);
    const creator = expectedCreator ?? keyAddress(state.creator);
    if (!owner || !creator) return notMembership(transactionId, outputIndex, covenantId);
    if (state.owner !== addressPublicKey(owner))
      return membership(transactionId, outputIndex, covenantId, owner, state.expiresAtDaa, currentDaa, "OWNER_MISMATCH", this.now);
    if (state.creator !== addressPublicKey(creator))
      return notMembership(transactionId, outputIndex, covenantId);

    const creatorPayment = transaction.outputs?.[2];
    const ownerPointer = transaction.outputs?.[3];
    if (
      outputAmount(creatorPayment) !== MEMBERSHIP_PRICE_SOMPI ||
      outputScript(creatorPayment) !== addressScript(creator) ||
      outputAmount(ownerPointer) !== MEMBERSHIP_INDEX_VALUE ||
      outputScript(ownerPointer) !== addressScript(owner) ||
      !(await this.isUnspent(membershipAddress(state), transactionId, outputIndex))
    ) return notMembership(transactionId, outputIndex, covenantId);

    const status = state.expiresAtDaa > currentDaa ? "VALID" : "EXPIRED";
    return membership(transactionId, outputIndex, covenantId, owner, state.expiresAtDaa, currentDaa, status, this.now);
  }

  private async isUnspent(address: string, transactionId: string, outputIndex: number): Promise<boolean> {
    const utxos = await this.utxos(address);
    return utxos.some((utxo) => utxo.outpoint.transactionId === transactionId && utxo.outpoint.index === outputIndex);
  }

  private transaction(transactionId: string): Promise<ChainTransaction> {
    return this.request<ChainTransaction>(`/transactions/${transactionId}`);
  }

  private async currentDaa(): Promise<bigint> {
    const value = await this.request<{ virtualDaaScore: string }>(`/info/blockdag?x=${Date.now()}`);
    return BigInt(value.virtualDaaScore);
  }

  private utxos(address: string): Promise<VerifierUtxo[]> {
    return this.request<VerifierUtxo[]>(`/addresses/${encodeURIComponent(address)}/utxos`);
  }

  private async request<T>(path: string): Promise<T> {
    const response = await fetch(`${this.api}${path}`, { headers: { "Content-Type": "application/json" } });
    if (!response.ok) {
      this.logger.error("membership_verification_failed", {
        endpoint: path.split("/")[1] ?? path,
        status: response.status,
      });
      throw new Error(`Kaspa verification failed: ${response.status} ${await response.text()}`);
    }
    return await response.json() as T;
  }
}

function membership(
  transactionId: string,
  outputIndex: number,
  covenantId: string,
  owner: string,
  expiresAtDaa: bigint,
  currentDaa: bigint,
  status: MembershipCheck["status"],
  now: () => number,
): MembershipCheck {
  const createdDaa = expiresAtDaa - MEMBERSHIP_DURATION_DAA;
  const estimate = (score: bigint) => new Date(now() + Number(score - currentDaa) * DAA_MILLISECONDS).toISOString();
  return {
    transactionId,
    outputIndex,
    covenantId,
    kind: "token",
    tokenType: "MINT",
    owner,
    createdAt: estimate(createdDaa),
    validUntil: estimate(expiresAtDaa),
    status,
  };
}

function outputCovenantId(output: ChainOutput | undefined): string | null {
  return output?.covenant_id ?? output?.covenantId ?? output?.covenant?.covenant_id ?? output?.covenant?.covenantId ?? null;
}

function outputAuthorizingInput(output: ChainOutput): number | null {
  return output.covenant_authorizing_input ?? output.authorizing_input ?? output.covenant?.authorizing_input ?? output.covenant?.authorizingInput ?? null;
}

function outputAmount(output: ChainOutput | undefined): bigint | null {
  return bigintOrNull(output?.amount ?? output?.value);
}

function outputScript(output: ChainOutput | undefined): string | null {
  if (!output) return null;
  const value = output.script_public_key ?? output.scriptPublicKey;
  if (typeof value === "string") return withVersion(value);
  if (!value) return null;
  if ("script" in value) return withVersion(value.script ?? "");
  const rest = value as { script_public_key?: string; scriptPublicKey?: string };
  return withVersion(rest.script_public_key ?? rest.scriptPublicKey ?? "");
}

function withVersion(script: string): string {
  return script.startsWith("0000") ? script : `0000${script}`;
}

function bigintOrNull(value: unknown): bigint | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  try { return BigInt(value); } catch { return null; }
}

function keyAddress(publicKey: string): string | null {
  try { return new XOnlyPublicKey(publicKey).toAddress("testnet-10").toString(); }
  catch { return null; }
}

function notMembership(transactionId: string, outputIndex: number, covenantId: string | null = null): MembershipCheck {
  return {
    transactionId,
    outputIndex,
    covenantId,
    kind: "none",
    tokenType: null,
    owner: null,
    createdAt: null,
    validUntil: null,
    status: "NOT_MEMBERSHIP",
  };
}
