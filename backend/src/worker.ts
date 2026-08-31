import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ObjectStorage, Store } from "./domain.js";
import { MediaValidationError, verifyMediaFile } from "./media.js";

export async function processNextUpload(
  store: Store,
  storage: ObjectStorage,
  now = Date.now(),
  staleMs = 300_000,
): Promise<boolean> {
  const upload = await store.claimUpload(now, now - staleMs);
  if (!upload) return false;
  const directory = await mkdtemp(join(tmpdir(), "onlykas-"));
  const mediaPath = join(directory, "media");
  try {
    await storage.download(upload.stagingKey, mediaPath);
    const media = await verifyMediaFile(mediaPath);
    const finalKey = `media/blake3/${media.digest.slice(0, 2)}/${media.digest}`;
    await storage.promote(upload.stagingKey, finalKey);
    await store.updateUpload({
      ...upload,
      state: "VERIFIED",
      updatedAt: now,
      digest: media.digest,
      mediaType: media.mediaType,
      mediaSize: media.size,
      finalKey,
      error: null,
    });
  } catch (error) {
    const category =
      error instanceof MediaValidationError
        ? error.category
        : "STORAGE_FAILURE";
    await store.updateUpload({
      ...upload,
      state: category === "STORAGE_FAILURE" ? "UPLOADED" : "REJECTED",
      updatedAt: now,
      error: category,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  return true;
}

export async function cleanupExpiredUploads(
  store: Store,
  storage: ObjectStorage,
  now = Date.now(),
): Promise<number> {
  const uploads = await store.expiredUploads(now);
  for (const upload of uploads) {
    if (upload.state === "CREATED")
      await storage.abortMultipart(upload.stagingKey, upload.multipartId);
    else await storage.delete(upload.stagingKey);
    await store.updateUpload({ ...upload, state: "EXPIRED", updatedAt: now });
  }
  return uploads.length;
}
