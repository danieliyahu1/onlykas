import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isVideoMedia, type MediaType } from "@kaskama/shared";
import sharp from "sharp";
import type { ObjectStorage } from "../../application/ports.js";
import {
  PREVIEW_CONTENT_TYPE,
  previewKey,
  type MediaPreview,
  type PreviewPost,
} from "../../application/media-preview.js";
import { logger as defaultLogger, safeError, type Logger } from "../../observability.js";

/**
 * Every post — image or video — gets the same teaser: one still, blurred by the
 * same amount, at the same size and quality. A video contributes the single
 * representative frame ffmpeg picks, so both types read as an equal smudge of
 * the scene. The treatment is baked into the stored JPEG so it cannot be removed
 * client-side, and the real media still requires unlock.
 */
const PREVIEW_MAX_EDGE = 300;
const PREVIEW_BLUR = 12;
const PREVIEW_QUALITY = 100;

export type PreviewStorage = Pick<ObjectStorage, "readRange" | "putFile">;

/** Renders a source file into a low-resolution blurred JPEG at `outputPath`. */
export type RenderPreview = (
  sourcePath: string,
  mediaType: MediaType,
  outputPath: string,
) => Promise<void>;

export function createMediaPreview(dependencies: {
  storage: PreviewStorage;
  render?: RenderPreview;
  ffmpegPath?: string;
  logger?: Logger;
}): MediaPreview {
  const logger = dependencies.logger ?? defaultLogger;
  const ffmpegPath = dependencies.ffmpegPath ?? process.env.FFMPEG_PATH ?? "ffmpeg";
  const render =
    dependencies.render ??
    ((source, mediaType, output) =>
      renderPreview(source, mediaType, output, ffmpegPath));
  const inflight = new Map<string, Promise<Uint8Array | null>>();

  async function generateAndStore(
    post: PreviewPost,
    key: string,
  ): Promise<Uint8Array | null> {
    const dir = await mkdtemp(join(tmpdir(), "kaskama-preview-"));
    try {
      const { bytes } = await dependencies.storage.readRange(post.mediaKey);
      const source = join(dir, "source");
      await writeFile(source, bytes);
      const output = join(dir, "preview.jpg");
      await render(source, post.mediaType, output);
      await dependencies.storage.putFile(key, output, PREVIEW_CONTENT_TYPE);
      return new Uint8Array(await readFile(output));
    } catch (error) {
      logger.warn("media_preview_failed", {
        postId: post.id,
        mediaKey: post.mediaKey,
        ...safeError(error),
      });
      return null;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  return {
    async ensure(post) {
      const key = previewKey(post.mediaKey);
      try {
        const cached = await dependencies.storage.readRange(key);
        if (cached.bytes.byteLength > 0) return cached.bytes;
      } catch {
        // A missing preview is expected for posts published before previews.
      }
      const pending = inflight.get(key);
      if (pending) return pending;
      const task = generateAndStore(post, key).finally(() => inflight.delete(key));
      inflight.set(key, task);
      return task;
    },
  };
}

export async function renderPreview(
  sourcePath: string,
  mediaType: MediaType,
  outputPath: string,
  ffmpegPath: string,
): Promise<void> {
  const framePath = isVideoMedia(mediaType)
    ? await extractVideoFrame(ffmpegPath, sourcePath, outputPath)
    : sourcePath;
  await sharp(framePath, { failOn: "error" })
    .rotate()
    .resize(PREVIEW_MAX_EDGE, PREVIEW_MAX_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .blur(PREVIEW_BLUR)
    .jpeg({ quality: PREVIEW_QUALITY })
    .toFile(outputPath);
}

async function extractVideoFrame(
  ffmpegPath: string,
  sourcePath: string,
  outputPath: string,
): Promise<string> {
  const framePath = `${outputPath}.frame.jpg`;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      [
        "-y",
        "-i",
        sourcePath,
        "-frames:v",
        "1",
        "-vf",
        `thumbnail,scale=${PREVIEW_MAX_EDGE}:${PREVIEW_MAX_EDGE}:force_original_aspect_ratio=decrease`,
        "-q:v",
        "3",
        framePath,
      ],
      { stdio: "ignore", windowsHide: true },
    );
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`)),
    );
  });
  return framePath;
}
