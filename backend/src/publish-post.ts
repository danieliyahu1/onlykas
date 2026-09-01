import {
  normalizePostText,
  parseKasToSompi,
  validatePost,
  type UploadError,
  type UploadState,
} from "@onlykas/shared";
import type { CommitPublicationResult, Post, Upload } from "./domain.js";

export interface PublishPostCommand {
  creator: string;
  uploadId: string;
  title: string;
  caption: string;
  priceKas: string;
}

export interface PublicationRepository {
  getUpload(id: string): Promise<Upload | null>;
  commitPublication(
    uploadId: string,
    creator: string,
    post: Post,
  ): Promise<CommitPublicationResult>;
}

export type PublishPostOutcome =
  | { type: "PUBLISHED"; post: Post }
  | { type: "INVALID_POST"; errors: string[] }
  | { type: "UPLOAD_NOT_FOUND" }
  | { type: "UPLOAD_FORBIDDEN" }
  | { type: "UPLOAD_NOT_READY"; state: UploadState; error: UploadError }
  | { type: "MEDIA_ALREADY_PUBLISHED" }
  | { type: "PUBLICATION_CONFLICT" };

interface PublishPostDependencies {
  repository: PublicationRepository;
  createId: () => string;
  now: () => number;
}

export async function publishPost(
  command: PublishPostCommand,
  dependencies: PublishPostDependencies,
): Promise<PublishPostOutcome> {
  const errors = validatePost(command.title, command.caption, command.priceKas);
  if (errors.length) return { type: "INVALID_POST", errors };

  const upload = await dependencies.repository.getUpload(command.uploadId);
  if (!upload) return { type: "UPLOAD_NOT_FOUND" };
  if (upload.creator !== command.creator) return { type: "UPLOAD_FORBIDDEN" };
  if (!isPublishable(upload))
    return {
      type: "UPLOAD_NOT_READY",
      state: upload.state,
      error: upload.error,
    };

  const post: Post = {
    id: dependencies.createId(),
    creator: command.creator,
    title: normalizePostText(command.title),
    caption: normalizePostText(command.caption),
    priceSompi: parseKasToSompi(command.priceKas)!.toString(),
    mediaType: upload.mediaType,
    mediaSize: upload.mediaSize,
    mediaDigest: upload.digest,
    mediaKey: upload.finalKey,
    publishedAt: dependencies.now(),
  };
  const result = await dependencies.repository.commitPublication(
    upload.id,
    command.creator,
    post,
  );
  if (result === "COMMITTED") return { type: "PUBLISHED", post };
  if (result === "MEDIA_DIGEST_CONFLICT")
    return { type: "MEDIA_ALREADY_PUBLISHED" };
  return { type: "PUBLICATION_CONFLICT" };
}

function isPublishable(upload: Upload): upload is Upload & {
  digest: string;
  mediaType: NonNullable<Upload["mediaType"]>;
  mediaSize: number;
  finalKey: string;
} {
  return (
    upload.state === "VERIFIED" &&
    upload.digest !== null &&
    upload.mediaType !== null &&
    upload.mediaSize !== null &&
    upload.finalKey !== null
  );
}
