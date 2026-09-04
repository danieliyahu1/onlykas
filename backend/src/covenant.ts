import { createHash } from "node:crypto";
import type { MembershipCovenant, MembershipOffer } from "./domain.js";

const MEMBERSHIP_ROYALTY_BPS = 1000;
const MEMBERSHIP_DURATION_MS = 24 * 60 * 60 * 1_000;

export function buildMembershipCovenantTemplate(
  creatorRoyaltyBps = MEMBERSHIP_ROYALTY_BPS,
  durationMs = MEMBERSHIP_DURATION_MS,
): string {
  return JSON.stringify({
    type: "KCC-0020",
    name: "OnlyKas Membership",
    version: 1,
    amount: 1,
    creatorRoyaltyBps,
    durationMs,
    mint: {
      rule: "EXACT_PRICE",
      fields: ["owner", "created_at", "valid_until"],
    },
    transfer: {
      rule: "ROYALTY_SPLIT",
      royaltyBps: creatorRoyaltyBps,
      fields: ["owner", "created_at", "valid_until"],
    },
  });
}

export function fingerprintTemplate(templateJson: string): string {
  return createHash("sha256").update(templateJson).digest("hex");
}

export function createMembershipCovenant(
  creatorRoyaltyBps = MEMBERSHIP_ROYALTY_BPS,
  durationMs = MEMBERSHIP_DURATION_MS,
): MembershipCovenant {
  const templateJson = buildMembershipCovenantTemplate(
    creatorRoyaltyBps,
    durationMs,
  );
  return {
    id: `covenant-${fingerprintTemplate(templateJson).slice(0, 16)}`,
    templateJson,
    templateFingerprint: fingerprintTemplate(templateJson),
    amount: "1",
    durationMs,
    creatorRoyaltyBps,
    createdAt: Date.now(),
  };
}

export function buildMintPayload(
  offer: MembershipOffer,
  buyer: string,
  createdAtMs: number,
): {
  inputs: { utxoId: string; amount: string }[];
  outputs: {
    value: string;
    scriptPublicKey: string;
    covenant: Record<string, unknown>;
  }[];
} {
  const amount = BigInt(offer.priceSompi);
  const covenantPayload = {
    type: "MINT",
    owner: buyer,
    offerId: offer.id,
    creator: offer.creator,
    created_at: createdAtMs,
    valid_until: createdAtMs + MEMBERSHIP_DURATION_MS,
  };
  return {
    inputs: [],
    outputs: [
      {
        value: "1",
        scriptPublicKey: "",
        covenant: {
          type: "KCC-0020",
          payload: covenantPayload,
        },
      },
    ],
  };
}

export function buildTransferPayload(
  membershipId: string,
  seller: string,
  buyer: string,
  saleAmountSompi: string,
  creatorRoyaltySompi: string,
  creatorPayoutAddress: string,
  createdAt: number,
  validUntil: number,
): {
  inputs: { utxoId: string; amount: string }[];
  outputs: {
    value: string;
    scriptPublicKey: string;
    covenant: Record<string, unknown> | null;
  }[];
} {
  const covenantPayload = {
    type: "TRANSFER",
    membershipId,
    owner: buyer,
    created_at: createdAt,
    valid_until: validUntil,
  };
  return {
    inputs: [],
    outputs: [
      {
        value: creatorRoyaltySompi,
        scriptPublicKey: "",
        covenant: {
          type: "KCC-0020",
          payload: covenantPayload,
        },
      },
      {
        value: String(
          BigInt(saleAmountSompi) - BigInt(creatorRoyaltySompi),
        ),
        scriptPublicKey: "",
        covenant: null,
      },
    ],
  };
}

export function computeCreatorRoyalty(
  saleAmountSompi: string,
  royaltyBps: number,
): string {
  const sale = BigInt(saleAmountSompi);
  const royalty = (sale * BigInt(royaltyBps) + 9999n) / 10000n;
  return royalty.toString();
}

export function verifyRoyaltySplit(
  outputs: { value: string; covenant: Record<string, unknown> | null }[],
  saleAmountSompi: string,
  creatorRoyaltyBps: number,
): boolean {
  const expectedRoyalty = computeCreatorRoyalty(
    saleAmountSompi,
    creatorRoyaltyBps,
  );
  const covenantOutput = outputs.find(
    (o) =>
      o.covenant &&
      typeof o.covenant === "object" &&
      "type" in o.covenant &&
      o.covenant.type === "KCC-0020",
  );
  if (!covenantOutput) return false;
  if (covenantOutput.value !== expectedRoyalty) return false;
  const otherOutput = outputs.find((o) => o !== covenantOutput);
  if (!otherOutput) return false;
  const expectedSeller =
    BigInt(saleAmountSompi) - BigInt(expectedRoyalty);
  return BigInt(otherOutput.value) === expectedSeller;
}
