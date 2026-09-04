import {
  createMembershipCovenant,
  buildMembershipCovenantTemplate,
  fingerprintTemplate,
  computeCreatorRoyalty,
  verifyRoyaltySplit,
  buildTransferPayload,
} from "./covenant.js";

describe("covenant template", () => {
  it("produces a deterministic fingerprint for the same parameters", () => {
    const a = createMembershipCovenant(1000, 86400_000);
    const b = createMembershipCovenant(1000, 86400_000);
    expect(a.templateFingerprint).toBe(b.templateFingerprint);
    expect(a.id).toBe(b.id);
  });

  it("produces different fingerprints for different royalty rates", () => {
    const a = createMembershipCovenant(1000, 86400_000);
    const b = createMembershipCovenant(2000, 86400_000);
    expect(a.templateFingerprint).not.toBe(b.templateFingerprint);
  });

  it("template parses as valid JSON with KCC-0020 type", () => {
    const covenant = createMembershipCovenant();
    const parsed = JSON.parse(covenant.templateJson);
    expect(parsed.type).toBe("KCC-0020");
    expect(parsed.amount).toBe(1);
    expect(parsed.creatorRoyaltyBps).toBe(1000);
    expect(parsed.mint.rule).toBe("EXACT_PRICE");
    expect(parsed.transfer.rule).toBe("ROYALTY_SPLIT");
  });

  it("fingerprintTemplate matches createHash sha256", () => {
    const template = buildMembershipCovenantTemplate();
    expect(fingerprintTemplate(template)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("computeCreatorRoyalty", () => {
  it("computes 10% royalty rounded up", () => {
    expect(computeCreatorRoyalty("1000", 1000)).toBe("100");
  });

  it("rounds up fractional sompi", () => {
    expect(computeCreatorRoyalty("1001", 1000)).toBe("101");
  });

  it("handles zero sale amount", () => {
    expect(computeCreatorRoyalty("0", 1000)).toBe("0");
  });

  it("handles large amounts", () => {
    const royalty = computeCreatorRoyalty("100000000", 1000);
    expect(royalty).toBe("10000000");
  });
});

describe("verifyRoyaltySplit", () => {
  it("accepts a valid 90/10 split", () => {
    const outputs = [
      { value: "100", covenant: { type: "KCC-0020", payload: {} } },
      { value: "900", covenant: null },
    ];
    expect(verifyRoyaltySplit(outputs, "1000", 1000)).toBe(true);
  });

  it("rejects when royalty amount is wrong", () => {
    const outputs = [
      { value: "50", covenant: { type: "KCC-0020", payload: {} } },
      { value: "950", covenant: null },
    ];
    expect(verifyRoyaltySplit(outputs, "1000", 1000)).toBe(false);
  });

  it("rejects when covenant output is missing", () => {
    const outputs = [{ value: "100", covenant: null }];
    expect(verifyRoyaltySplit(outputs, "1000", 1000)).toBe(false);
  });

  it("rejects when seller payout is wrong", () => {
    const outputs = [
      { value: "100", covenant: { type: "KCC-0020", payload: {} } },
      { value: "800", covenant: null },
    ];
    expect(verifyRoyaltySplit(outputs, "1000", 1000)).toBe(false);
  });
});

describe("buildTransferPayload", () => {
  it("creates transfer payload with correct covenant structure", () => {
    const payload = buildTransferPayload(
      "mem-1",
      "seller",
      "buyer",
      "1000",
      "100",
      "creator",
      1000,
      2000,
    );
    expect(payload.outputs).toHaveLength(2);
    expect(payload.outputs[0]!.covenant).toMatchObject({
      type: "KCC-0020",
      payload: {
        type: "TRANSFER",
        membershipId: "mem-1",
        owner: "buyer",
        created_at: 1000,
        valid_until: 2000,
      },
    });
    expect(payload.outputs[0]!.value).toBe("100");
    expect(payload.outputs[1]!.value).toBe("900");
    expect(payload.outputs[1]!.covenant).toBeNull();
  });
});
