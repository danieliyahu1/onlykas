import { ApiError, toApiError } from "./api-error.js";

describe("toApiError", () => {
  it("keeps the server code, status, and request id", () => {
    const error = toApiError(502, {
      error: "MEDIA_STORAGE_FAILED",
      message: "Media storage is unavailable.",
      requestId: "trace-1",
    });

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: "MEDIA_STORAGE_FAILED",
      message: "Media storage is unavailable.",
      status: 502,
      requestId: "trace-1",
    });
  });

  it("falls back when the server sends no body", () => {
    const error = toApiError(500, null);

    expect(error.code).toBe("REQUEST_FAILED");
    expect(error.status).toBe(500);
    expect(error.requestId).toBeUndefined();
  });
});
