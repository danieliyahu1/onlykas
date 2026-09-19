import type { MembershipCheck } from "./domain/models.js";
import type { MembershipVerifier } from "./application/ports.js";
import { XOnlyPublicKey } from "@kluster/kaspa-wasm";
import { logger as defaultLogger, type Logger } from "./observability.js";
import { defaultMetrics, type Metrics } from "./metrics.js";
import {
  addressPublicKey,
  decodeMembershipRedeemScript,
  MEMBERSHIP_INDEX_VALUE,
  membershipAddress,
  membershipScript,
  parseMembershipPayloadDetails,
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
    private readonly metrics: Metrics = defaultMetrics,
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

  async findMembership(
    owner: string,
    creator: string,
    expectedCovenantId?: string,
  ): Promise<MembershipCheck | null> {
    const [utxos, currentDaa] = await Promise.all([this.utxos(owner), this.currentDaa()]);
    const pointers = utxos.filter((utxo) => bigintOrNull(utxo.utxoEntry.amount) === MEMBERSHIP_INDEX_VALUE);
    for (const pointer of pointers) {
      const transaction = await this.transaction(pointer.outpoint.transactionId);
      const check = await this.checkMemberOutput(
        pointer.outpoint.transactionId,
        1,
        transaction,
        currentDaa,
        owner,
        expectedCovenantId,
        creator,
      );
      if (check.status === "VALID") return check;
    }
    return null;
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
    const payload = parseMembershipPayloadDetails(transaction.payload);
    const state = payload ? decodeMembershipRedeemScript(payload.memberRedeemScript) : null;
    if (
      !transaction.is_accepted ||
      transaction.version !== 1 ||
      outputIndex !== 1 ||
      !output ||
      !covenantId ||
      !payload ||
      !state ||
      state.isMinter ||
      outputScript(output) !== membershipScript(state) ||
      outputAuthorizingInput(output) !== 0 ||
      (expectedCovenantId !== undefined && covenantId !== expectedCovenantId)
    ) return notMembership(transactionId, outputIndex, covenantId);

    const owner = expectedOwner ?? keyAddress(state.owner);
    const creator = expectedCreator ?? keyAddress(state.creator);
    const platformAddress = keyAddress(state.platform);
    if (!owner || !creator || !platformAddress) return notMembership(transactionId, outputIndex, covenantId);
    if (state.owner !== addressPublicKey(owner))
      return membership(transactionId, outputIndex, covenantId, owner, creator, platformAddress, payload.metadata.createdAtDaa, state.expiresAtDaa, currentDaa, "OWNER_MISMATCH", this.now);
    if (state.creator !== addressPublicKey(creator))
      return notMembership(transactionId, outputIndex, covenantId);
    if (!(await this.isUnspent(membershipAddress(state), transactionId, outputIndex)))
      return notMembership(transactionId, outputIndex, covenantId);

    const status = state.expiresAtDaa > currentDaa ? "VALID" : "EXPIRED";
    return membership(transactionId, outputIndex, covenantId, owner, creator, platformAddress, payload.metadata.createdAtDaa, state.expiresAtDaa, currentDaa, status, this.now);
  }

  private async isUnspent(address: string, transactionId: string, outputIndex: number): Promise<boolean> {
    const utxos = await this.utxos(address);
    return utxos.some((utxo) => utxo.outpoint.transactionId === transactionId && utxo.outpoint.index === outputIndex);
  }

  private transaction(transactionId: string): Promise<ChainTransaction> {
    return this.request<ChainTransaction>("transaction", `/transactions/${transactionId}`);
  }

  private async currentDaa(): Promise<bigint> {
    const value = await this.request<{ virtualDaaScore: string }>("blockdag", `/info/blockdag?x=${Date.now()}`);
    return BigInt(value.virtualDaaScore);
  }

  private utxos(address: string): Promise<VerifierUtxo[]> {
    return this.request<VerifierUtxo[]>("utxos", `/addresses/${encodeURIComponent(address)}/utxos`);
  }

  private async request<T>(operation: string, path: string): Promise<T> {
    return this.metrics.observeDependency("kaspa_rest", operation, async () => {
      const response = await fetch(`${this.api}${path}`, { headers: { "Content-Type": "application/json" } });
      if (!response.ok) {
        this.logger.error("membership_verification_failed", {
          endpoint: path.split("/")[1] ?? path,
          status: response.status,
        });
        throw new Error(`Kaspa verification failed: ${response.status} ${await response.text()}`);
      }
      const body: unknown = await response.json();
      if (!body || typeof body !== "object")
        throw new Error("INVALID_KASPA_RESPONSE");
      return body as T;
    });
  }
}

function membership(
  transactionId: string,
  outputIndex: number,
  covenantId: string,
  owner: string,
  contentCreator: string,
  platformAddress: string,
  createdAtDaa: bigint,
  expiresAtDaa: bigint,
  currentDaa: bigint,
  status: MembershipCheck["status"],
  now: () => number,
): MembershipCheck {
  const estimate = (score: bigint) => new Date(now() + Number(score - currentDaa) * DAA_MILLISECONDS).toISOString();
  return {
    transactionId,
    outputIndex,
    covenantId,
    kind: "token",
    tokenType: "membership",
    owner,
    contentCreator,
    platformAddress,
    createdAtDaa: createdAtDaa.toString(),
    expiresAtDaa: expiresAtDaa.toString(),
    createdAt: estimate(createdAtDaa),
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
    contentCreator: null,
    platformAddress: null,
    createdAtDaa: null,
    expiresAtDaa: null,
    createdAt: null,
    validUntil: null,
    status: "NOT_MEMBERSHIP",
  };
}
