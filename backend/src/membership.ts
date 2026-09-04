import { MEMBERSHIP_DURATION_MS } from "./covenant.js";
import type { Membership, MembershipMintAttempt, Store } from "./domain.js";

export async function buildMintedMembership(
  store: Store,
  attempt: MembershipMintAttempt,
  acceptedAtMs: number | null,
  now = Date.now(),
): Promise<Membership> {
  const covenant = attempt.covenantId
    ? await store.getCovenant(attempt.covenantId)
    : null;
  const createdAt = acceptedAtMs ?? now;
  const durationMs = covenant?.durationMs ?? MEMBERSHIP_DURATION_MS;
  return {
    id: attempt.id,
    offerId: attempt.offerId,
    owner: attempt.buyer,
    creator: attempt.creator,
    covenantId: attempt.covenantId,
    createdTxId: attempt.signedTransactionId,
    validUntil: createdAt + durationMs,
    state: "ACTIVE",
    createdAt,
    updatedAt: now,
  };
}
