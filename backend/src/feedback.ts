// Anonymous user feedback delivery.
//
// The browser sends only a message. The server validates it, durably writes it
// to a spill queue before anything can fail, forwards it to a private Telegram
// chat via `sendMessage`, and silently retries queued entries until they land.
// A Telegram outage therefore never loses feedback: the entry is stored first
// and sent when the bot is reachable again. The bot token and chat id come from
// the environment and never reach the browser, and the feedback text itself is
// never logged.
//
// Telegram is deliberately invisible to the user: from their point of view the
// app accepts "a bug, an idea, or something that felt confusing" and thanks
// them. If Telegram is not configured the feedback is still stored in the spill
// queue and delivered once the bot is configured, and a `feedback_delivery_disabled`
// warning is logged so the missing bot is noticed without breaking the app.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { FEEDBACK_MAX_MESSAGE } from "@onlykas/shared";

export class FeedbackError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FeedbackError";
  }
}

export function validateFeedback(input: { message?: unknown } = {}): {
  message: string;
} {
  const message =
    typeof input.message === "string" ? input.message.trim() : "";
  if (!message)
    throw new FeedbackError("INVALID_FEEDBACK", "Feedback message is required");
  if (message.length > FEEDBACK_MAX_MESSAGE) {
    throw new FeedbackError(
      "FEEDBACK_TOO_LONG",
      `Feedback must be at most ${FEEDBACK_MAX_MESSAGE} characters`,
    );
  }
  return { message };
}

export function formatFeedbackMessage(entry: { message: string }): string {
  return [`New OnlyKas feedback:`, "", entry.message].join("\n");
}

export interface FeedbackMetrics {
  recordFeedback(fields: { outcome: string }): void;
}

export class TelegramFeedback {
  constructor(
    {
      botToken,
      chatId,
      fetchImpl = fetch,
      endpoint,
    }: {
      botToken?: string;
      chatId?: string;
      fetchImpl?: typeof fetch;
      endpoint?: string;
    } = {},
  ) {
    this.botToken = botToken;
    this.chatId = chatId;
    this.fetchImpl = fetchImpl;
    this.endpoint =
      endpoint ?? `https://api.telegram.org/bot${botToken}/sendMessage`;
  }

  private readonly botToken: string | undefined;
  private readonly chatId: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly endpoint: string;

  get enabled(): boolean {
    return Boolean(this.botToken) && Boolean(this.chatId);
  }

  async deliver(entry: { message: string }): Promise<void> {
    if (!this.enabled) throw new Error("Telegram feedback is not configured");
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: this.chatId,
        text: formatFeedbackMessage(entry),
        disable_web_page_preview: true,
      }),
    });
    if (!response.ok)
      throw new Error(`Telegram sendMessage failed with HTTP ${response.status}`);
  }
}

export interface FeedbackEntry {
  id: string;
  receivedAt: string;
  message: string;
}

export class FeedbackSpill {
  constructor(
    {
      filePath,
      now = () => new Date(),
    }: {
      filePath: string;
      now?: () => Date;
    },
  ) {
    this.filePath = filePath;
    this.now = now;
  }

  readonly filePath: string;
  private readonly now: () => Date;
  entries: FeedbackEntry[] = [];
  private loaded = false;

  async add(feedback: { message: string }): Promise<FeedbackEntry> {
    await this.#load();
    const entry: FeedbackEntry = {
      id: randomUUID(),
      receivedAt: this.now().toISOString(),
      ...feedback,
    };
    this.entries.push(entry);
    await this.#persist();
    return this.entries[this.entries.length - 1]!;
  }

  async remove(entry: FeedbackEntry): Promise<void> {
    await this.#load();
    const next = this.entries.filter((candidate) => candidate.id !== entry.id);
    if (next.length === this.entries.length) return;
    this.entries = next;
    await this.#persist();
  }

  // Retries every queued entry once. Entries the handler accepts are removed;
  // failures stay queued for the next drain.
  async drain(handler: (entry: FeedbackEntry) => Promise<void>): Promise<void> {
    await this.#load();
    const remaining: FeedbackEntry[] = [];
    let changed = false;
    for (const entry of this.entries) {
      try {
        await handler(entry);
        changed = true;
      } catch {
        remaining.push(entry);
      }
    }
    if (changed) {
      this.entries = remaining;
      await this.#persist();
    }
  }

  async #load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) this.entries = parsed as FeedbackEntry[];
    } catch {
      // First run, empty file, or unreadable file: start with an empty queue.
    }
  }

  async #persist() {
    const temporary = `${this.filePath}.tmp`;
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(temporary, JSON.stringify(this.entries), "utf8");
    await rename(temporary, this.filePath);
  }
}

export class FeedbackService {
  constructor(
    {
      deliverer,
      spill,
      metrics,
      now = () => new Date(),
      logger = console,
    }: {
      deliverer: {
        enabled: boolean;
        deliver(entry: FeedbackEntry): Promise<void>;
      };
      spill: FeedbackSpill;
      metrics?: FeedbackMetrics;
      now?: () => Date;
      logger?: {
        info?: (event: string, fields?: Record<string, unknown>) => void;
        warn?: (event: string, fields?: Record<string, unknown>) => void;
        error?: (event: string, fields?: Record<string, unknown>) => void;
      };
    },
  ) {
    this.deliverer = deliverer;
    this.spill = spill;
    this.metrics = metrics;
    this.now = now;
    this.logger = logger;
  }

  private readonly deliverer: {
    enabled: boolean;
    deliver(entry: FeedbackEntry): Promise<void>;
  };
  readonly spill: FeedbackSpill;
  private readonly metrics: FeedbackMetrics | undefined;
  private readonly now: () => Date;
  private readonly logger: {
    info?: (event: string, fields?: Record<string, unknown>) => void;
    warn?: (event: string, fields?: Record<string, unknown>) => void;
    error?: (event: string, fields?: Record<string, unknown>) => void;
  };

  // Write-ahead: the feedback is durable before anything can fail, so a
  // Telegram outage, a missing bot, or a crash mid-flight never loses it. An
  // entry accepted while the bot is not configured stays queued and is
  // delivered by the next drain once the bot is configured.
  async submit(input: { message?: unknown }): Promise<{
    accepted: true;
    queued?: true;
  }> {
    const feedback = validateFeedback(input);
    const entry = await this.spill.add(feedback);
    if (!this.deliverer.enabled) {
      const reason =
        "TELEGRAM_FEEDBACK_BOT_TOKEN or TELEGRAM_FEEDBACK_CHAT_ID is not set";
      this.metrics?.recordFeedback({ outcome: "disabled" });
      this.logger.warn?.("feedback_delivery_disabled", { reason });
      return { accepted: true, queued: true };
    }
    try {
      await this.deliverer.deliver(entry);
      await this.spill.remove(entry);
      this.metrics?.recordFeedback({ outcome: "delivered" });
      return { accepted: true };
    } catch (error) {
      this.metrics?.recordFeedback({ outcome: "queued" });
      this.logger.error?.("feedback_delivery_failed", {
        message:
          error instanceof Error ? error.message : String(error),
      });
      return { accepted: true, queued: true };
    }
  }

  async drainPending(): Promise<void> {
    let drained = 0;
    await this.spill.drain(async (entry) => {
      await this.deliverer.deliver(entry);
      this.metrics?.recordFeedback({ outcome: "delivered" });
      drained += 1;
    });
    if (drained > 0)
      this.logger.info?.("feedback_delivered_from_queue", { count: drained });
  }
}