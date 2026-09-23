import { previewUrl } from "./preview-url.js";

describe("previewUrl", () => {
  it("versions the URL so a changed poster is not served from cache", () => {
    expect(previewUrl("post-1")).toBe("/api/posts/post-1/preview?v=8");
  });

  it("encodes identifiers that are not URL-safe", () => {
    expect(previewUrl("post/one two")).toBe(
      "/api/posts/post%2Fone%20two/preview?v=8",
    );
  });
});
