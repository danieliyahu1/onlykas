import { previewKey } from "./media-preview.js";

describe("preview key", () => {
  it("derives a versioned sibling preview object from a media key", () => {
    expect(previewKey("media/creator/ab/digest")).toBe(
      "previews/v8/creator/ab/digest.jpg",
    );
  });

  it("still derives a key when the media key has no media prefix", () => {
    expect(previewKey("custom-key")).toBe("previews/v8/custom-key.jpg");
  });
});
