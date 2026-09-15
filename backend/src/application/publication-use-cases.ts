import type { Post } from "../domain/models.js";
import type { ObjectStorage, PostRepository } from "./ports.js";

export interface VerifiedMedia {
  digest: string;
  mediaType: Post["mediaType"];
  size: number;
}

export interface PublishPostInput {
  creator: string;
  caption: string;
  priceSompi: string;
  sourcePath: string;
  now: number;
}

export type PublishPostResult = { kind: "CREATED"; post: Post } | { kind: "DUPLICATE" };

export function createPublishPostUseCase(dependencies: {
  posts: Pick<
    PostRepository,
    | "reservePublication"
    | "commitPublication"
    | "releasePublication"
    | "prunePendingPublications"
  >;
  storage: Pick<ObjectStorage, "putFile" | "delete">;
  verifyMedia: (path: string) => Promise<VerifiedMedia>;
  createId: () => string;
  pendingTtlMs: number;
}): (input: PublishPostInput) => Promise<PublishPostResult> {
  return async (input) => {
    const media = await dependencies.verifyMedia(input.sourcePath);
    const post: Post = {
      id: dependencies.createId(),
      creator: input.creator,
      caption: input.caption,
      priceSompi: input.priceSompi,
      mediaType: media.mediaType,
      mediaSize: media.size,
      mediaDigest: media.digest,
      mediaKey: `media/blake3/${media.digest.slice(0, 2)}/${media.digest}`,
      publishedAt: input.now,
    };
    await dependencies.posts.prunePendingPublications(input.now);
    const reservation = await dependencies.posts.reservePublication(
      post,
      input.now + dependencies.pendingTtlMs,
    );
    if (reservation === "DUPLICATE") return { kind: "DUPLICATE" };

    try {
      await dependencies.storage.putFile(
        post.mediaKey,
        input.sourcePath,
        post.mediaType,
      );
    } catch (error) {
      await dependencies.posts.releasePublication(post.id);
      await dependencies.storage.delete(post.mediaKey).catch(() => undefined);
      throw error;
    }

    const committed = await dependencies.posts.commitPublication(post);
    if (committed === "DUPLICATE") return { kind: "DUPLICATE" };
    return { kind: "CREATED", post };
  };
}
