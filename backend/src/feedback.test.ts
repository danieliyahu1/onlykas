import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FEEDBACK_MAX_MESSAGE } from "@onlykas/shared";
import {
  FeedbackError,
  FeedbackService,
  FeedbackSpill,
  TelegramFeedback,
  formatFeedbackMessage,
  validateFeedback,
} from "./feedback.js";
import { createMetrics, type Metrics } from "./metrics.js";

function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

function testMetrics(): Metrics {
  return createMetrics({ version: "test", revision: "test" });
}

function errorCode(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof FeedbackError ? error.code : String(error);
  }
  throw new Error("expected fn to throw");
}

describe("validateFeedback", () => {
  it("rejects an empty message", () => {
    expect(() => validateFeedback({})).toThrow(FeedbackError);
    expect(() => validateFeedback({ message: "" })).toThrow(FeedbackError);
    expect(() => validateFeedback({ message: "   " })).toThrow(FeedbackError);
    expect(() => validateFeedback({ message: null })).toThrow(FeedbackError);
    expect(errorCode(() => validateFeedback({ message: null }))).toBe(
      "INVALID_FEEDBACK",
    );
  });

  it("rejects messages over the length limit", () => {
    expect(errorCode(() =>
      validateFeedback({ message: "x".repeat(FEEDBACK_MAX_MESSAGE + 1) }),
    )).toBe("FEEDBACK_TOO_LONG");
  });

  it("returns a trimmed message", () => {
    expect(validateFeedback({ message: "  The reveal felt confusing  " })).toEqual({
      message: "The reveal felt confusing",
    });
  });
});

describe("formatFeedbackMessage", () => {
  it("is the title and the message, nothing else", () => {
    const text = formatFeedbackMessage({ message: "The unlock felt off." });
    expect(text).toBe("New OnlyKas feedback:\n\nThe unlock felt off.");
    expect(text).not.toMatch(/Page:/);
    expect(text).not.toMatch(/Address:|kaspatest:/i);
  });
});

describe("TelegramFeedback", () => {
  it("reports enabled only when both token and chat id are set", () => {
    expect(new TelegramFeedback({}).enabled).toBe(false);
    expect(new TelegramFeedback({ botToken: "123" }).enabled).toBe(false);
    expect(new TelegramFeedback({ chatId: "123" }).enabled).toBe(false);
    expect(
      new TelegramFeedback({ botToken: "123", chatId: "123" }).enabled,
    ).toBe(true);
  });

  it("rejects delivery when not configured", async () => {
    const telegram = new TelegramFeedback({});
    await expect(telegram.deliver({ message: "hi" })).rejects.toThrow();
  });

  it("posts to the Telegram sendMessage endpoint", async () => {
    const calls: Array<{ url: string; body: { chat_id: string; text: string; disable_web_page_preview: boolean } }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    const telegram = new TelegramFeedback({
      botToken: "tok",
      chatId: "42",
      fetchImpl,
    });

    await telegram.deliver({ message: "Test feedback" });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toMatch(/bottok\/sendMessage/);
    expect(calls[0]!.body.chat_id).toBe("42");
    expect(calls[0]!.body.text).toContain("Test feedback");
    expect(calls[0]!.body.disable_web_page_preview).toBe(true);
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = (async () => new Response("", { status: 401 })) as typeof fetch;
    const telegram = new TelegramFeedback({
      botToken: "bad",
      chatId: "1",
      fetchImpl,
    });
    await expect(telegram.deliver({ message: "hi" })).rejects.toThrow(/401/);
  });
});

describe("FeedbackSpill", () => {
  it("persists entries to disk and loads them on construction", async () => {
    const dir = await tempDir("feedback-spill-");
    try {
      const filePath = join(dir, "spill.json");
      const now = () => new Date("2026-01-01T00:00:00.000Z");

      const first = new FeedbackSpill({ filePath, now });
      const entry = await first.add({ message: "queued" });
      expect(entry.id).toBeTruthy();
      expect(entry.message).toBe("queued");
      const raw = await readFile(filePath, "utf8");
      expect(raw).toContain("queued");

      const second = new FeedbackSpill({ filePath, now });
      await second.drain(async () => {
        throw new Error("keep");
      });
      expect(second.entries).toHaveLength(1);
      expect(second.entries[0]!.id).toBe(entry.id);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("remove deletes an entry by id", async () => {
    const dir = await tempDir("feedback-spill-remove-");
    try {
      const spill = new FeedbackSpill({
        filePath: join(dir, "spill.json"),
        now: () => new Date("2026-01-01T00:00:00.000Z"),
      });
      const entry = await spill.add({ message: "to remove" });
      expect(spill.entries).toHaveLength(1);
      await spill.remove(entry);
      expect(spill.entries).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("drain retries entries that fail and keeps those that succeed", async () => {
    const dir = await tempDir("feedback-spill-drain-");
    try {
      const spill = new FeedbackSpill({ filePath: join(dir, "spill.json") });
      await spill.add({ message: "a" });
      const b = await spill.add({ message: "b" });
      await spill.add({ message: "c" });

      let callCount = 0;
      await spill.drain(async (entry) => {
        callCount += 1;
        if (entry.id === b.id) throw new Error("transient");
      });

      expect(callCount).toBe(3);
      expect(spill.entries).toHaveLength(1);
      expect(spill.entries[0]!.id).toBe(b.id);
      const raw = await readFile(spill.filePath, "utf8");
      expect(raw).not.toMatch(/"message":"a"/);
      expect(raw).toMatch(/"message":"b"/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("FeedbackService", () => {
  it("writes-ahead to spill, delivers successfully, and removes the entry", async () => {
    const dir = await tempDir("feedback-service-ok-");
    try {
      const spill = new FeedbackSpill({ filePath: join(dir, "spill.json") });
      const calls: unknown[] = [];
      const deliverer = {
        enabled: true,
        deliver: async (entry: unknown) => {
          calls.push(entry);
        },
      };
      const metrics = testMetrics();
      const service = new FeedbackService({
        deliverer,
        spill,
        metrics,
        now: () => new Date("2026-01-01T00:00:00.000Z"),
      });

      const result = await service.submit({ message: "All good" });

      expect(result.accepted).toBe(true);
      expect(result.queued).toBeUndefined();
      expect(calls).toHaveLength(1);
      expect(spill.entries).toHaveLength(0);
      expect(await metrics.render()).toContain(
        'onlykas_feedback_total{outcome="delivered"}',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("spills but still returns accepted when delivery fails", async () => {
    const dir = await tempDir("feedback-service-fail-");
    try {
      const spill = new FeedbackSpill({ filePath: join(dir, "spill.json") });
      const deliverer = {
        enabled: true,
        deliver: async () => {
          throw new Error("Telegram down");
        },
      };
      const service = new FeedbackService({
        deliverer,
        spill,
        logger: { error() {} },
      });

      const result = await service.submit({ message: "Help" });

      expect(result.accepted).toBe(true);
      expect(result.queued).toBe(true);
      expect(spill.entries).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stores feedback with a warning when Telegram is not configured", async () => {
    const dir = await tempDir("feedback-service-disabled-");
    try {
      const warnings: Array<{ event: string; fields?: Record<string, unknown> }> = [];
      const metrics = testMetrics();
      const service = new FeedbackService({
        deliverer: { enabled: false, deliver: async () => undefined },
        spill: new FeedbackSpill({ filePath: join(dir, "spill.json") }),
        metrics,
        logger: {
          warn: (event, fields) =>
            warnings.push({ event, ...(fields ? { fields } : {}) }),
        },
      });

      const result = await service.submit({ message: "offline note" });

      expect(result.accepted).toBe(true);
      expect(result.queued).toBe(true);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.event).toBe("feedback_delivery_disabled");
      expect(String(warnings[0]!.fields?.reason)).toContain(
        "TELEGRAM_FEEDBACK_BOT_TOKEN",
      );
      expect(service.spill.entries).toHaveLength(1);
      expect(service.spill.entries[0]!.message).toBe("offline note");
      expect(await metrics.render()).toContain(
        'onlykas_feedback_total{outcome="disabled"}',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects invalid feedback without touching the queue", async () => {
    const dir = await tempDir("feedback-service-invalid-");
    try {
      const service = new FeedbackService({
        deliverer: { enabled: false, deliver: async () => undefined },
        spill: new FeedbackSpill({ filePath: join(dir, "spill.json") }),
      });

      await expect(service.submit({ message: "   " })).rejects.toThrow(
        FeedbackError,
      );
      expect(service.spill.entries).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("drainPending retries spilled entries", async () => {
    const dir = await tempDir("feedback-drain-");
    try {
      const spill = new FeedbackSpill({ filePath: join(dir, "spill.json") });
      await spill.add({ message: "drain me" });
      expect(spill.entries).toHaveLength(1);

      const delivered: string[] = [];
      const deliverer = {
        enabled: true,
        deliver: async (entry: { message: string }) => {
          delivered.push(entry.message);
        },
      };
      const service = new FeedbackService({
        deliverer,
        spill,
        logger: { info() {} },
      });

      await service.drainPending();

      expect(delivered).toEqual(["drain me"]);
      expect(spill.entries).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});