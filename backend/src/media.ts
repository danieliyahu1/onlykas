import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { blake3 } from "@noble/hashes/blake3.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { fileTypeFromFile } from "file-type";
import sharp from "sharp";
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  MEDIA_TYPES,
  type MediaType,
  type UploadError,
} from "@onlykas/shared";

const execFileAsync = promisify(execFile);
const ffprobePath = process.env.FFPROBE_PATH ?? bundledFfprobePath();
const imageTypes = new Set<MediaType>([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const videoTypes = new Set<MediaType>(["video/mp4", "video/webm"]);

export interface VerifiedMedia {
  digest: string;
  mediaType: MediaType;
  size: number;
}

export class MediaValidationError extends Error {
  constructor(readonly category: Exclude<UploadError, null>) {
    super(category);
  }
}

export async function verifyMediaFile(path: string): Promise<VerifiedMedia> {
  const size = (await stat(path)).size;
  const detected = await fileTypeFromFile(path);
  const mediaType = detected?.mime as MediaType | undefined;
  if (!mediaType || !MEDIA_TYPES.includes(mediaType))
    throw new MediaValidationError("UNSUPPORTED_MEDIA");

  if (imageTypes.has(mediaType)) {
    if (size > MAX_IMAGE_BYTES)
      throw new MediaValidationError("IMAGE_TOO_LARGE");
    await decodeCompleteImage(path);
  } else if (videoTypes.has(mediaType)) {
    if (size > MAX_VIDEO_BYTES)
      throw new MediaValidationError("VIDEO_TOO_LARGE");
    await probeCompleteVideo(path);
  }

  return { digest: await hashFile(path), mediaType, size };
}

async function decodeCompleteImage(path: string): Promise<void> {
  try {
    const discard = new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    });
    await pipeline(sharp(path, { failOn: "error" }).raw(), discard);
  } catch {
    throw new MediaValidationError("MALFORMED_MEDIA");
  }
}

async function probeCompleteVideo(path: string): Promise<void> {
  try {
    const { stdout } = await execFileAsync(
      ffprobePath,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration,format_name",
        "-of",
        "json",
        path,
      ],
      { timeout: 30_000, maxBuffer: 1_000_000 },
    );
    const result = JSON.parse(stdout) as {
      format?: { duration?: string; format_name?: string };
    };
    const duration = Number(result.format?.duration);
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      !result.format?.format_name
    )
      throw new Error("Invalid video probe");
  } catch (error) {
    if (isExecutableFailure(error)) throw error;
    throw new MediaValidationError("MALFORMED_MEDIA");
  }
}

function bundledFfprobePath(): string {
  try {
    return (
      createRequire(import.meta.url)("ffprobe-static") as { path: string }
    ).path;
  } catch {
    return "ffprobe";
  }
}

function isExecutableFailure(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "EACCES" || code === "ENOEXEC";
}

async function hashFile(path: string): Promise<string> {
  const hash = blake3.create();
  for await (const chunk of createReadStream(path))
    hash.update(chunk as Buffer);
  return bytesToHex(hash.digest());
}
