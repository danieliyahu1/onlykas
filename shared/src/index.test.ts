import {
  COPY,
  MAX_IMAGE_BYTES,
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
    expect(validatePost(" title ", " description ", "2")).toEqual([]);
    expect(validatePost(" ", " ", "0")).toEqual([
      "Title must be between 1 and 80 characters.",
      "Description must be between 1 and 280 characters.",
      COPY.invalidPrice,
    ]);
  });
});

describe("media hint validation", () => {
  it("rejects unsupported and oversized media before upload", () => {
    expect(mediaHintError("text/plain", 1)).toBe(COPY.unsupportedMedia);
    expect(mediaHintError("image/png", MAX_IMAGE_BYTES + 1)).toBe(
      COPY.imageTooLarge,
    );
    expect(mediaHintError("image/png", MAX_IMAGE_BYTES)).toBeNull();
  });
});
