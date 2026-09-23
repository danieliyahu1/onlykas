import { diagnoseAddress } from "./address-diagnostic.js";

describe("diagnoseAddress", () => {
  it("flags a missing value without inventing a prefix", () => {
    expect(diagnoseAddress(undefined, "kaspatest")).toEqual({ problem: "missing" });
    expect(diagnoseAddress(null, "kaspatest")).toEqual({ problem: "missing" });
  });

  it("flags a non-string value", () => {
    expect(diagnoseAddress(42, "kaspatest")).toEqual({ problem: "not_string" });
  });

  it("names the wrong network by its prefix", () => {
    expect(diagnoseAddress("kaspa:abc123", "kaspatest")).toEqual({
      problem: "wrong_prefix",
      prefix: "kaspa",
      lengthBucket: 12,
    });
  });

  it("reports a malformed address without exposing its contents", () => {
    const diagnostic = diagnoseAddress("kaspatest:deadbeef", "kaspatest");
    expect(diagnostic).toEqual({
      problem: "bad_shape",
      prefix: "kaspatest",
      lengthBucket: 18,
    });
    expect(JSON.stringify(diagnostic)).not.toContain("deadbeef");
  });
});
