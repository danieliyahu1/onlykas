import { redact, requestId, safeError } from "./observability.js";

describe("observability safeguards", () => {
  it("redacts sensitive fields and URLs recursively", () => {
    expect(
      redact({
        signature: "signed-transaction",
        transaction: '{"inputs":[]}',
        cookie: "onlykas_session=secret",
        nested: { url: "https://example.test/private?token=abc" },
        state: "CONFIRMED",
      }),
    ).toEqual({
      signature: "[REDACTED]",
      transaction: "[REDACTED]",
      cookie: "[REDACTED]",
      nested: { url: "[REDACTED]" },
      state: "CONFIRMED",
    });
    expect(
      redact("signature=signed cookie=session-token https://private.test"),
    ).toBe("signature=[REDACTED] cookie=[REDACTED] [URL_REDACTED]");
  });

  it("accepts bounded request IDs and replaces unsafe values", () => {
    expect(requestId("trace-123")).toBe("trace-123");
    expect(requestId("bad value")).not.toBe("bad value");
  });

  it("preserves structured storage failure details for diagnostics", () => {
    const error = new Error("head_object failed for media/hash", {
      cause: Object.assign(new Error("The specified key does not exist."), {
        name: "UnknownError",
        Code: "NoSuchKey",
        $metadata: { httpStatusCode: 404 },
      }),
    });
    Object.assign(error, {
      name: "StorageError",
      operation: "head_object",
      key: "media/hash",
      category: "OBJECT_NOT_FOUND",
      statusCode: 404,
      serviceCode: "NoSuchKey",
      requestId: "r2-request",
    });
    expect(safeError(error)).toMatchObject({
      errorName: "StorageError",
      storageOperation: "head_object",
      storageKey: "media/hash",
      storageCategory: "OBJECT_NOT_FOUND",
      storageStatusCode: 404,
      storageServiceCode: "NoSuchKey",
      storageRequestId: "r2-request",
      storageCauseName: "UnknownError",
      storageCauseMessage: "The specified key does not exist.",
      storageCauseCode: "NoSuchKey",
      storageCauseStatusCode: 404,
    });
  });
});
