import { MembershipAccess } from "./membership-access.js";
import type {
  CovenantRepository,
  MembershipPurchaseRepository,
  MembershipVerifier,
} from "./ports.js";
import type { MembershipCheck, MembershipPurchase } from "../domain/models.js";

const buyer = "kaspatest:buyer";
const creator = "kaspatest:creator";

function check(
  transactionId: string,
  status: MembershipCheck["status"],
): MembershipCheck {
  return {
    transactionId,
    outputIndex: 1,
    covenantId: "covenant-1",
    kind: status === "NOT_MEMBERSHIP" ? "none" : "token",
    tokenType: "membership",
    owner: buyer,
    contentCreator: creator,
    platformAddress: "kaspatest:platform",
    createdAtDaa: "1",
    expiresAtDaa: "2",
    createdAt: null,
    validUntil: null,
    status,
  };
}

function harness(options: {
  receipts?: MembershipPurchase[];
  receiptStatus?: MembershipCheck["status"];
  found?: MembershipCheck | null;
  covenantId?: string;
  verifier?: boolean;
}) {
  const receipts = options.receipts ?? [];
  const saved: MembershipPurchase[] = [];
  const repository: MembershipPurchaseRepository = {
    createMembershipPurchase: async (value) => {
      saved.push(value);
      return "CREATED";
    },
    membershipReceipts: async () => receipts,
    finalizeMembershipPurchase: async () => "CREATED",
  };
  const covenants: CovenantRepository = {
    getCreatorCovenant: async () =>
      options.covenantId
        ? { creator, covenantId: options.covenantId, priceSompi: "1000000000" }
        : null,
    saveCreatorCovenant: async () => "CREATED",
    finalizeOffer: async () => "CREATED",
  };
  const verifyUtxo = vi.fn(async (transactionId: string) =>
    check(transactionId, options.receiptStatus ?? "VALID"),
  );
  const findMembership = vi.fn(async () => options.found ?? null);
  const verifier: MembershipVerifier = {
    verifyAddress: async () => [],
    findMembership,
    verifyUtxo,
  };
  const access = new MembershipAccess(
    covenants,
    repository,
    options.verifier === false ? undefined : verifier,
  );
  return { access, saved, verifyUtxo, findMembership };
}

describe("MembershipAccess", () => {
  it("accepts a stored receipt that still verifies on chain", async () => {
    const { access, verifyUtxo, findMembership } = harness({
      receipts: [{ transactionId: "tx-1", buyer, creator }],
      covenantId: "covenant-1",
    });

    await expect(access.isActive(buyer, creator)).resolves.toBe(true);
    expect(verifyUtxo).toHaveBeenCalledWith("tx-1", 1, buyer, "covenant-1", creator);
    expect(findMembership).not.toHaveBeenCalled();
  });

  it("discovers a membership by scanning the address and caches it", async () => {
    const { access, saved, findMembership } = harness({
      found: check("tx-scan", "VALID"),
    });

    await expect(access.isActive(buyer, creator)).resolves.toBe(true);
    expect(findMembership).toHaveBeenCalledWith(buyer, creator, undefined);
    expect(saved).toEqual([{ transactionId: "tx-scan", buyer, creator }]);
  });

  it("falls back to a scan when stored receipts have expired", async () => {
    const { access, findMembership } = harness({
      receipts: [{ transactionId: "tx-old", buyer, creator }],
      receiptStatus: "EXPIRED",
      found: check("tx-scan", "VALID"),
    });

    await expect(access.isActive(buyer, creator)).resolves.toBe(true);
    expect(findMembership).toHaveBeenCalledTimes(1);
  });

  it("denies access when nothing valid is on chain", async () => {
    const { access } = harness({ found: null });

    await expect(access.isActive(buyer, creator)).resolves.toBe(false);
  });

  it("denies access when no verifier is configured", async () => {
    const { access, findMembership } = harness({
      found: check("tx-scan", "VALID"),
      verifier: false,
    });

    await expect(access.isActive(buyer, creator)).resolves.toBe(false);
    expect(findMembership).not.toHaveBeenCalled();
  });
});
