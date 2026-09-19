import { parsePpvPayload, ppvPayload } from "./ppv-payload.js";

const digest = "a".repeat(64);

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("hex");
}

describe("PPV transaction payload", () => {
  it("round-trips the post identity and self-describing media hash", () => {
    const payload = ppvPayload("post-1", digest.toUpperCase());

    expect(parsePpvPayload(payload)).toEqual({
      protocol: "onlykas",
      version: 1,
      type: "post-purchase",
      postId: "post-1",
      mediaHash: {
        algorithm: "blake3-256",
        encoding: "hex",
        digest,
      },
    });
  });

  it("reads legacy version 1 metadata that stored a bare media digest", () => {
    const payload = encode({
      protocol: "onlykas",
      version: 1,
      type: "post-purchase",
      postId: "post-1",
      mediaDigest: digest.toUpperCase(),
    });

    expect(parsePpvPayload(payload)).toEqual({
      protocol: "onlykas",
      version: 1,
      type: "post-purchase",
      postId: "post-1",
      mediaHash: {
        algorithm: "blake3-256",
        encoding: "hex",
        digest,
      },
    });
  });

  it("rejects malformed or incomplete metadata", () => {
    expect(parsePpvPayload("not-hex")).toBeNull();
    expect(parsePpvPayload(encode({ protocol: "onlykas" }))).toBeNull();
    expect(parsePpvPayload(encode({
      protocol: "onlykas", version: 1, type: "post-purchase", postId: "",
      mediaHash: { algorithm: "blake3-256", encoding: "hex", digest },
    }))).toBeNull();
  });

  it("rejects an unknown hash algorithm", () => {
    expect(parsePpvPayload(encode({
      protocol: "onlykas", version: 1, type: "post-purchase", postId: "post-1",
      mediaHash: { algorithm: "sha256", encoding: "hex", digest },
    }))).toBeNull();
  });

  it("rejects an unknown digest encoding", () => {
    expect(parsePpvPayload(encode({
      protocol: "onlykas", version: 1, type: "post-purchase", postId: "post-1",
      mediaHash: { algorithm: "blake3-256", encoding: "base64", digest },
    }))).toBeNull();
  });

  it("rejects a digest that is not 32 encoded bytes", () => {
    expect(parsePpvPayload(encode({
      protocol: "onlykas", version: 1, type: "post-purchase", postId: "post-1",
      mediaHash: { algorithm: "blake3-256", encoding: "hex", digest: "abcd" },
    }))).toBeNull();
  });
});
