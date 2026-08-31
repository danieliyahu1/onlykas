import { redact, requestId } from "./observability.js";

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
});
