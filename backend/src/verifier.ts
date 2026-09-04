import {
  buildMembershipCovenantTemplate,
  fingerprintTemplate,
  MEMBERSHIP_COVENANT_PREFIX,
  MEMBERSHIP_DURATION_MS,
} from "./covenant.js";
import type {
  MembershipCheck,
  MembershipCheckStatus,
  MembershipVerifier,
} from "./domain.js";

export interface MembershipToken {
  type: "MINT" | "TRANSFER";
  owner: string;
  createdAt: number;
  validUntil: number;
  offerId?: string;
  creator?: string;
  membershipId?: string;
}

export interface MembershipDeploy {
  type: "DEPLOY_COVENANT";
  templateFingerprint: string;
  template: string;
  payoutPk: string;
  deployer: string;
}

export function membershipCovenantId(templateJson: string): string {
  return `${MEMBERSHIP_COVENANT_PREFIX}${fingerprintTemplate(templateJson).slice(0, 16)}`;
}

export function canonicalMembershipCovenantId(): string {
  return membershipCovenantId(buildMembershipCovenantTemplate());
}

export function isMembershipCovenant(
  covenant: unknown,
): covenant is { type: string; payload?: unknown } {
  if (!covenant || typeof covenant !== "object") return false;
  return (covenant as Record<string, unknown>).type === "KCC-0020";
}

export function parseCovenantPayload(
  payload: unknown,
): Record<string, unknown> | null {
  if (payload === null || payload === undefined) return null;
  let value: unknown = payload;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (
    typeof value === "string" &&
    value.trim() !== "" &&
    Number.isFinite(Number(value))
  )
    return Number(value);
  return null;
}

export function recognizeMembershipToken(
  covenant: unknown,
): MembershipToken | null {
  if (!isMembershipCovenant(covenant)) return null;
  const payload = parseCovenantPayload(covenant.payload);
  if (!payload) return null;
  if (payload.type !== "MINT" && payload.type !== "TRANSFER") return null;
  const owner = requiredString(payload, "owner");
  const createdAt = numberOrNull(payload.created_at);
  const validUntil = numberOrNull(payload.valid_until);
  if (!owner || createdAt === null || validUntil === null) return null;
  if (validUntil - createdAt !== MEMBERSHIP_DURATION_MS) return null;
  const token: MembershipToken = {
    type: payload.type,
    owner,
    createdAt,
    validUntil,
  };
  if (typeof payload.offerId === "string") token.offerId = payload.offerId;
  if (typeof payload.creator === "string") token.creator = payload.creator;
  if (typeof payload.membershipId === "string")
    token.membershipId = payload.membershipId;
  return token;
}

export function recognizeMembershipDeploy(
  covenant: unknown,
): MembershipDeploy | null {
  if (!isMembershipCovenant(covenant)) return null;
  const payload = parseCovenantPayload(covenant.payload);
  if (!payload) return null;
  if (payload.type !== "DEPLOY_COVENANT") return null;
  const templateFingerprint = requiredString(payload, "templateFingerprint");
  const template = requiredString(payload, "template");
  const payoutPk = requiredString(payload, "payoutPk");
  const deployer = requiredString(payload, "deployer");
  if (!templateFingerprint || !template || !payoutPk || !deployer) return null;
  if (fingerprintTemplate(template) !== templateFingerprint) return null;
  return {
    type: "DEPLOY_COVENANT",
    templateFingerprint,
    template,
    payoutPk,
    deployer,
  };
}

export function membershipTokenValidity(
  token: MembershipToken,
  expectedOwner: string | undefined,
  now: number,
): Exclude<MembershipCheckStatus, "NOT_MEMBERSHIP"> {
  if (expectedOwner !== undefined && token.owner !== expectedOwner)
    return "OWNER_MISMATCH";
  return token.validUntil > now ? "VALID" : "EXPIRED";
}

type VerifierUtxo = {
  outpoint: { transactionId: string; index: number };
  utxoEntry: {
    amount: string;
    scriptPublicKey: { scriptPublicKey: string };
    blockDaaScore?: string;
    isCoinbase?: boolean;
    covenant?: unknown;
  };
};

export class KaspaMembershipVerifier implements MembershipVerifier {
  constructor(
    private readonly api = "https://api-tn10.kaspa.org",
    private readonly now: () => number = Date.now,
  ) {}

  async verifyAddress(
    address: string,
    expectedOwner?: string,
  ): Promise<MembershipCheck[]> {
    const utxos = await this.utxos(address);
    return Promise.all(
      utxos.map((utxo) => this.checkUtxo(utxo, expectedOwner)),
    );
  }

  async verifyUtxo(
    transactionId: string,
    outputIndex: number,
    expectedOwner?: string,
  ): Promise<MembershipCheck> {
    const covenant = await this.transactionCovenant(transactionId, outputIndex);
    return this.categorize(transactionId, outputIndex, covenant, expectedOwner);
  }

  private async checkUtxo(
    utxo: VerifierUtxo,
    expectedOwner?: string,
  ): Promise<MembershipCheck> {
    const covenant = await this.covenantForUtxo(utxo);
    return this.categorize(
      utxo.outpoint.transactionId,
      utxo.outpoint.index,
      covenant,
      expectedOwner,
    );
  }

  private async covenantForUtxo(utxo: VerifierUtxo): Promise<unknown> {
    if (utxo.utxoEntry.covenant !== undefined) return utxo.utxoEntry.covenant;
    return this.transactionCovenant(
      utxo.outpoint.transactionId,
      utxo.outpoint.index,
    );
  }

  private async transactionCovenant(
    transactionId: string,
    outputIndex: number,
  ): Promise<unknown> {
    const transaction = await this.request<{
      outputs?: { covenant?: unknown }[];
    }>(`/transactions/${transactionId}`);
    return transaction.outputs?.[outputIndex]?.covenant ?? null;
  }

  private categorize(
    transactionId: string,
    outputIndex: number,
    covenant: unknown,
    expectedOwner?: string,
  ): MembershipCheck {
    const token = recognizeMembershipToken(covenant);
    if (!token) {
      const deploy = recognizeMembershipDeploy(covenant);
      return {
        transactionId,
        outputIndex,
        covenantId: deploy ? membershipCovenantId(deploy.template) : null,
        kind: deploy ? "deploy" : "none",
        tokenType: null,
        owner: null,
        createdAt: null,
        validUntil: null,
        status: "NOT_MEMBERSHIP",
      };
    }
    return {
      transactionId,
      outputIndex,
      covenantId: canonicalMembershipCovenantId(),
      kind: "token",
      tokenType: token.type,
      owner: token.owner,
      createdAt: new Date(token.createdAt).toISOString(),
      validUntil: new Date(token.validUntil).toISOString(),
      status: membershipTokenValidity(token, expectedOwner, this.now()),
    };
  }

  private async utxos(address: string): Promise<VerifierUtxo[]> {
    return this.request<VerifierUtxo[]>(
      `/addresses/${encodeURIComponent(address)}/utxos`,
    );
  }

  private async request<T>(path: string): Promise<T> {
    const response = await fetch(`${this.api}${path}`, {
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `Kaspa verification failed: ${response.status} ${detail}`,
      );
    }
    return (await response.json()) as T;
  }
}
