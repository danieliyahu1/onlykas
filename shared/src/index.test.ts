import {
  MAX_MEMBERSHIP_PRICE_SOMPI,
  MIN_MEMBERSHIP_PRICE_SOMPI,
  membershipFeeSompi,
  parseMembershipPrice,
  MEDIA_COPY,
  MAX_IMAGE_BYTES,
  isFreePost,
  isKaspaTestnetAddress,
  isVideoMedia,
  mediaHintError,
  parseKasToSompi,
  parsePostPrice,
  validatePost,
} from "./index.js";

describe("membership pricing", () => {
  it.each([
    ["1", MIN_MEMBERSHIP_PRICE_SOMPI],
    ["1000000", MAX_MEMBERSHIP_PRICE_SOMPI],
    ["99.9999995", 9_999_999_950n],
  ])("accepts %s KAS", (value, expected) => {
    expect(parseMembershipPrice(value)).toBe(expected);
  });

  it.each(["0.99999999", "1000000.00000001", "1.000000001", "invalid"])(
    "rejects %s",
    (value) => expect(parseMembershipPrice(value)).toBeNull(),
  );

  it("waives the fee below 100 KAS and charges exactly 1 KAS at the threshold", () => {
    expect(membershipFeeSompi(50n * 100_000_000n)).toBe(0n);
    expect(membershipFeeSompi(9_999_999_949n)).toBe(0n);
    expect(membershipFeeSompi(9_999_999_950n)).toBe(100_000_000n);
    expect(membershipFeeSompi(100n * 100_000_000n)).toBe(100_000_000n);
  });

  it("rounds the one percent fee to the nearest sompi", () => {
    expect(membershipFeeSompi(10_000_000_049n)).toBe(100_000_000n);
    expect(membershipFeeSompi(10_000_000_050n)).toBe(100_000_001n);
  });
});

describe("post validation", () => {
  it("converts exact KAS decimals to whole sompi", () => {
    expect(parseKasToSompi("1.00000001")).toBe(100_000_001n);
    expect(parseKasToSompi("0.00000001")).toBe(1n);
  });

  it.each(["", "0", "-1", "1.000000001", "one"])(
    "rejects invalid payable price %s",
    (price) => {
      expect(parseKasToSompi(price)).toBeNull();
    },
  );

  it("accepts a zero price only through parsePostPrice", () => {
    expect(parsePostPrice("0")).toBe(0n);
    expect(parsePostPrice("0.00")).toBe(0n);
    expect(parsePostPrice("1.00000001")).toBe(100_000_001n);
    expect(parsePostPrice("0.00000001")).toBe(1n);
  });

  it.each(["", "-1", "1.000000001", "one"])(
    "rejects malformed post price %s",
    (price) => {
      expect(parsePostPrice(price)).toBeNull();
    },
  );

  it("flags free posts by their stored sompi value", () => {
    expect(isFreePost("0")).toBe(true);
    expect(isFreePost("1")).toBe(false);
  });

  it("flags video media types", () => {
    expect(isVideoMedia("video/mp4")).toBe(true);
    expect(isVideoMedia("video/webm")).toBe(true);
    expect(isVideoMedia("image/png")).toBe(false);
  });

  it("normalizes text and enforces visible character limits", () => {
    expect(validatePost(" caption ", "2")).toEqual([]);
    expect(validatePost(" caption ", "0")).toEqual([]);
    expect(validatePost(" ", "0")).toEqual([
      "Caption must be between 1 and 280 characters.",
    ]);
    expect(validatePost("x".repeat(281), "1")).toEqual([
      "Caption must be between 1 and 280 characters.",
    ]);
    expect(validatePost("x", "-1")).toEqual([MEDIA_COPY.invalidPrice]);
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
