import { ApiError } from "./api-error.js";
import { errorText } from "./errors.js";

describe("errorText", () => {
  it("shows a short reference for server faults", () => {
    const error = new ApiError(
      "MEDIA_STORAGE_FAILED",
      "Upload failed.",
      502,
      "abcdef1234567890",
    );

    expect(errorText(error, "fallback")).toBe("Upload failed. (ref: abcdef12)");
  });

  it("does not reference user errors", () => {
    const error = new ApiError(
      "INVALID_POST",
      "Caption is required.",
      400,
      "abcdef1234567890",
    );

    expect(errorText(error, "fallback")).toBe("Caption is required.");
  });

  it("does not reference network failures", () => {
    const error = new ApiError("SERVER_UNAVAILABLE", "Server is down.", 0);

    expect(errorText(error, "fallback")).toBe("Server is down.");
  });

  it("falls back for errors without a message", () => {
    expect(errorText(new Error(""), "fallback")).toBe("fallback");
  });
});
