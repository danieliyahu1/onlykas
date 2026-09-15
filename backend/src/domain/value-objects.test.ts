import {
  covenantId,
  kaspaAddress,
  mediaDigest,
  sompi,
  transactionId,
} from "./value-objects.js";

describe("domain value objects", () => {
  it("accepts valid protocol identifiers", () => {
    expect(kaspaAddress(`kaspatest:${"q".repeat(40)}`)).toContain("kaspatest:");
    expect(sompi("100000000")).toBe(100000000n);
    expect(transactionId("a".repeat(64))).toBe("a".repeat(64));
    expect(covenantId("b".repeat(64))).toBe("b".repeat(64));
    expect(mediaDigest("c".repeat(64))).toBe("c".repeat(64));
  });

  it.each([
    [kaspaAddress, "kaspatest:invalid"],
    [transactionId, "tx"],
    [covenantId, "covenant"],
    [mediaDigest, "digest"],
  ])("rejects invalid identifier %s", (parse, value) => {
    expect(() => parse(value)).toThrow();
  });

  it("rejects zero and negative amounts", () => {
    expect(() => sompi("0")).toThrow("INVALID_SOMPI");
    expect(() => sompi(-1n)).toThrow("INVALID_SOMPI");
  });
});
