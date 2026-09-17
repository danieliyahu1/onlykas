import { discardTempDir } from "./temp-files.js";
import type { EventLogger, Logger } from "./observability.js";

function recordingLogger(
  events: Array<{ event: string; fields: Record<string, unknown> }>,
): Logger {
  const record =
    (level: string): EventLogger =>
    (event, fields = {}) => {
      events.push({ event, fields: { level, ...fields } });
    };
  return {
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
  };
}

describe("discardTempDir", () => {
  it("logs a warning instead of throwing when cleanup fails", async () => {
    const events: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const logger = recordingLogger(events);
    const failure = new Error("EBUSY: resource busy or locked, unlink 'media'");

    await expect(
      discardTempDir("C:\\Temp\\onlykas-publish-test", logger, async () => {
        throw failure;
      }),
    ).resolves.toBeUndefined();

    expect(events).toContainEqual({
      event: "temp_cleanup_failed",
      fields: expect.objectContaining({
        level: "warn",
        dir: "C:\\Temp\\onlykas-publish-test",
        errorMessage: "EBUSY: resource busy or locked, unlink 'media'",
      }),
    });
  });

  it("removes the directory without logging when cleanup succeeds", async () => {
    const events: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const removed: string[] = [];

    await discardTempDir("C:\\Temp\\onlykas-publish-test", recordingLogger(events), async (dir) => {
      removed.push(dir);
    });

    expect(removed).toEqual(["C:\\Temp\\onlykas-publish-test"]);
    expect(events).toHaveLength(0);
  });
});
