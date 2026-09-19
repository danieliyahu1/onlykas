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
    const covenantId = (await this.covenants.getCreatorCovenant(creator))?.covenantId;
    for (const receipt of await this.receipts.membershipReceipts(buyer, creator)) {
      const check = await this.verifier.verifyUtxo(
        receipt.transactionId,
        1,
        buyer,
        covenantId,
        creator,
      );
      if (check.status === "VALID") return true;
    }
    const found = await this.verifier.findMembership(buyer, creator, covenantId);
    if (!found) return false;
    try {
      await this.receipts.createMembershipPurchase({
        transactionId: found.transactionId,
        buyer,
        creator,
      });
    } catch {
      // Caching the discovery must never block a valid membership.
    }
    return true;
  }
}
