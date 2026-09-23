import type { Post } from "../domain/models.js";

/** Previews are always JPEG stills, even for videos. */
export const PREVIEW_CONTENT_TYPE = "image/jpeg";

/**
 * Bumping the version invalidates every cached preview, so a change to the
 * rendering (resolution, blur strength) regenerates on the next request rather
 * than serving a stale treatment.
 */
const PREVIEW_VERSION = "v8";

/**
 * A preview lives beside its original in the same bucket. The key is derived
 * from the media key, so no database column is needed and every post — including
 * ones published before previews existed — is covered.
 */
export function previewKey(mediaKey: string): string {
  const suffix = mediaKey.startsWith("media/")
    ? mediaKey.slice("media/".length)
    : mediaKey;
  return `previews/${PREVIEW_VERSION}/${suffix}.jpg`;
}

export type PreviewPost = Pick<Post, "id" | "mediaKey" | "mediaType">;

export interface MediaPreview {
  /**
   * Returns the blurred preview for a post, generating and storing it on the
   * first call. Returns null when it cannot be produced, so callers keep their
   * locked placeholder instead of exposing the original.
   */
  ensure(post: PreviewPost): Promise<Uint8Array | null>;
}
