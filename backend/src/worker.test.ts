import sharp from "sharp";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { UPLOAD_TTL_MS, type MediaType } from "@onlykas/shared";
import { MemoryStore } from "./memory-store.js";
import { TestStorage } from "./test-storage.js";
import {
  cleanupExpiredUploads,
  processNextUpload,
  reconcilePendingPayments,
} from "./worker.js";

const ffmpegPath = createRequire(import.meta.url)("ffmpeg-static") as
  string | null;

describe("media jobs", () => {
  it("probes a complete playable video before promotion", async () => {
    if (!ffmpegPath) throw new Error("ffmpeg test binary is unavailable");
    const store = new MemoryStore();
    const storage = new TestStorage();
    const path = join(tmpdir(), `onlykas-video-${randomUUID()}.mp4`);
    try {
      await promisify(execFile)(
        ffmpegPath,
        [
          "-f",
          "lavfi",
          "-i",
          "color=c=black:s=16x16:d=0.1",
          "-an",
          "-c:v",
          "libx264",
          "-movflags",
          "+faststart",
          "-y",
          path,
        ],
        { timeout: 30_000 },
      );
      await seedUpload(
        store,
        storage,
        "video",
        new Uint8Array(await readFile(path)),
      );
      await processNextUpload(store, storage, 2);
      expect(store.uploads.get("video")).toMatchObject({
        state: "VERIFIED",
        mediaType: "video/mp4",
      });
    } finally {
      await rm(path, { force: true });
    }
  });

  it("rejects malformed complete files and keeps storage failures retryable", async () => {
    const store = new MemoryStore();
    const storage = new TestStorage();
    await seedUpload(
      store,
      storage,
      "malformed",
      new TextEncoder().encode("not an image"),
    );
    await processNextUpload(store, storage, 2);
    expect(store.uploads.get("malformed")).toMatchObject({
      state: "REJECTED",
      error: "UNSUPPORTED_MEDIA",
    });

    await seedUpload(store, storage, "missing", new Uint8Array());
    storage.objects.delete("staging/missing");
    await processNextUpload(store, storage, 3);
    expect(store.uploads.get("missing")).toMatchObject({
      state: "UPLOADED",
      error: "STORAGE_FAILURE",
    });
  });

  it("promotes exact bytes by stable BLAKE3 digest and cleans abandoned uploads only", async () => {
    const store = new MemoryStore();
    const storage = new TestStorage();
    const image = new Uint8Array(
      await sharp({
        create: { width: 2, height: 2, channels: 3, background: "white" },
      })
        .jpeg()
        .toBuffer(),
    );
    await seedUpload(store, storage, "valid", image);
    await processNextUpload(store, storage, 10);
    const verified = store.uploads.get("valid")!;
    expect(verified.state).toBe("VERIFIED");
    expect(verified.finalKey).toBe(
      `media/blake3/${verified.digest!.slice(0, 2)}/${verified.digest}`,
    );
    expect(storage.objects.get(verified.finalKey!)?.bytes).toEqual(image);

    await seedUpload(store, storage, "expired", image, 0);
    expect(await cleanupExpiredUploads(store, storage, UPLOAD_TTL_MS + 1)).toBe(
      1,
    );
    expect(store.uploads.get("expired")?.state).toBe("EXPIRED");
    expect(store.uploads.get("valid")?.state).toBe("VERIFIED");
  });

  it("reconciles a submitted payment by status without submitting again", async () => {
    const store = new MemoryStore();
    await store.createPaymentAttempt({
      id: "attempt",
      postId: "post",
      buyer: "buyer",
      amountSompi: "100",
      creator: "creator",
      preparedTransaction: "prepared",
      fingerprint: "fingerprint",
      signedTransactionId: "a".repeat(64),
      state: "PENDING",
      rejection: null,
      submittedAt: 10,
      lastCheckedAt: null,
      reconciliationAttempts: 0,
      createdAt: 1,
      updatedAt: 10,
    });
    let submitCount = 0;
    const gateway = {
      prepare: async () => ({
        transaction: "prepared",
        fingerprint: "fingerprint",
        amountSompi: "100",
        creator: "creator",
      }),
      submit: async () => {
        submitCount += 1;
        throw new Error("must not submit");
      },
      status: async (transactionId: string) => ({
        isAccepted: true,
        transactionId,
        rejection: null,
      }),
    };

    expect(await reconcilePendingPayments(store, gateway, 20)).toBe(1);
    expect(submitCount).toBe(0);
    expect(await store.hasPurchase("post", "buyer")).toBe(true);
    expect((await store.getPaymentAttempt("attempt"))?.state).toBe("CONFIRMED");
  });
});

async function seedUpload(
  store: MemoryStore,
  storage: TestStorage,
  id: string,
  bytes: Uint8Array,
  expiresAt = UPLOAD_TTL_MS * 2,
) {
  const stagingKey = `staging/${id}`;
  storage.objects.set(stagingKey, {
    bytes,
    contentType: "application/octet-stream",
  });
  await store.createUpload({
    id,
    creator: "creator",
    stagingKey,
    multipartId: `multipart-${id}`,
    state: "UPLOADED",
    hintedType: "image/jpeg",
    hintedSize: bytes.length,
    expiresAt,
    updatedAt: 1,
    error: null,
    digest: null,
    mediaType: null as MediaType | null,
    mediaSize: null,
    finalKey: null,
    parts: [{ partNumber: 1, etag: "etag" }],
  });
}
