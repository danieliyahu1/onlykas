import type {
  CovenantRepository,
  MembershipPurchaseRepository,
  MembershipVerifier,
} from "./ports.js";

export class MembershipAccess {
  constructor(
    private readonly covenants: CovenantRepository,
    private readonly receipts: MembershipPurchaseRepository,
    private readonly verifier?: MembershipVerifier,
  ) {}

  async isActive(buyer: string, creator: string): Promise<boolean> {
    if (!this.verifier) return false;
    const current = await this.covenants.getCreatorCovenant(creator);
    const known = this.covenants.listCreatorCovenants
      ? await this.covenants.listCreatorCovenants(creator)
      : current
        ? [current]
        : [];
    const covenantIds = new Set(known.map((value) => value.covenantId));
    if (current) covenantIds.add(current.covenantId);
    for (const receipt of await this.receipts.membershipReceipts(buyer, creator)) {
      const ids = receipt.covenantId ? [receipt.covenantId] : [...covenantIds];
      for (const covenantId of ids) {
        const check = await this.verifier.verifyUtxo(
          receipt.transactionId,
          1,
          buyer,
          covenantId,
          creator,
        );
        if (check.status === "VALID") return true;
      }
    }
    const ids = covenantIds.size ? [...covenantIds] : [undefined];
    for (const covenantId of ids) {
      const found = await this.verifier.findMembership(buyer, creator, covenantId);
      if (!found) continue;
      try {
        await this.receipts.createMembershipPurchase({
          transactionId: found.transactionId,
          buyer,
          creator,
          ...(covenantId ? { covenantId } : {}),
        });
      } catch {
        // Caching the discovery must never block a valid membership.
      }
      return true;
    }
    return false;
  }
}
