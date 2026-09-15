import {
  MEDIA_COPY,
  MAX_IMAGE_BYTES,
  isKaspaTestnetAddress,
  mediaHintError,
  parseKasToSompi,
  validatePost,
} from "./index.js";

describe("post validation", () => {
  it("converts exact KAS decimals to whole sompi", () => {
    expect(parseKasToSompi("1.00000001")).toBe(100_000_001n);
    expect(parseKasToSompi("0.00000001")).toBe(1n);
  });

  it.each(["", "0", "-1", "1.000000001", "one"])(
    "rejects invalid price %s",
    (price) => {
      expect(parseKasToSompi(price)).toBeNull();
    },
  );

  it("normalizes text and enforces visible character limits", () => {
    expect(validatePost(" caption ", "2")).toEqual([]);
    expect(validatePost(" ", "0")).toEqual([
      "Caption must be between 1 and 280 characters.",
      MEDIA_COPY.invalidPrice,
    ]);
    expect(validatePost("x".repeat(281), "1")).toEqual([
      "Caption must be between 1 and 280 characters.",
    ]);
  });
});

describe("Kaspa testnet address validation", () => {
  it("accepts only complete lowercase testnet addresses", () => {
    expect(isKaspaTestnetAddress(`kaspatest:${"q".repeat(40)}`)).toBe(true);
    expect(isKaspaTestnetAddress(`kaspatest:${"q".repeat(80)}`)).toBe(true);
    expect(isKaspaTestnetAddress(`kaspatest:${"Q".repeat(60)}`)).toBe(false);
    expect(isKaspaTestnetAddress(`kaspatest:${"q".repeat(39)}`)).toBe(false);
    expect(isKaspaTestnetAddress(`kaspatest:${"q".repeat(81)}`)).toBe(false);
  });
});

describe("media hint validation", () => {
  it("rejects unsupported and oversized media before upload", () => {
    expect(mediaHintError("text/plain", 1)).toBe(MEDIA_COPY.unsupportedMedia);
    expect(mediaHintError("image/png", MAX_IMAGE_BYTES + 1)).toBe(
      MEDIA_COPY.imageTooLarge,
    );
    expect(mediaHintError("image/png", MAX_IMAGE_BYTES)).toBeNull();
  });
});
