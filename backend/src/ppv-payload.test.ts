import { parsePpvPayload, ppvPayload } from "./ppv-payload.js";

describe("PPV transaction payload", () => {
  it("round-trips the post identity and media commitment", () => {
    const payload = ppvPayload("post-1", "a".repeat(64));

    expect(parsePpvPayload(payload)).toEqual({
      protocol: "onlykas",
      version: 1,
      type: "post-purchase",
      postId: "post-1",
      mediaDigest: "a".repeat(64),
    });
  });

  it("rejects malformed or incomplete metadata", () => {
    expect(parsePpvPayload("not-hex")).toBeNull();
    expect(parsePpvPayload(Buffer.from(JSON.stringify({ protocol: "onlykas" })).toString("hex"))).toBeNull();
  });
});
