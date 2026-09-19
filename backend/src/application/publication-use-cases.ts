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

export type PublishPostResult =
  | { kind: "CREATED"; post: Post }
  | { kind: "DUPLICATE"; post: Post | null };

export function createPublishPostUseCase(dependencies: {
  posts: Pick<
    PostRepository,
    | "reservePublication"
    | "commitPublication"
    | "releasePublication"
    | "prunePendingPublications"
    | "findPostByMedia"
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
      mediaKey: `media/${input.creator}/${media.digest.slice(0, 2)}/${media.digest}`,
      publishedAt: input.now,
    };
    const duplicateResult = async (): Promise<PublishPostResult> => ({
      kind: "DUPLICATE",
      post: await dependencies.posts.findPostByMedia(
        post.creator,
        post.mediaDigest,
      ),
    });
    const releaseReservation = () =>
      dependencies.posts.releasePublication(post.id).catch(() => undefined);

    await dependencies.posts.prunePendingPublications(input.now);
    const reservation = await dependencies.posts.reservePublication(
      post,
      input.now + dependencies.pendingTtlMs,
    );
    if (reservation === "DUPLICATE") return duplicateResult();

    try {
      await dependencies.storage.putFile(
        post.mediaKey,
        input.sourcePath,
        post.mediaType,
      );
    } catch (error) {
      await releaseReservation();
      await dependencies.storage.delete(post.mediaKey).catch(() => undefined);
      throw error;
    }

    let committed: "COMMITTED" | "DUPLICATE";
    try {
      committed = await dependencies.posts.commitPublication(post);
    } catch (error) {
      await releaseReservation();
      throw error;
    }
    if (committed === "DUPLICATE") {
      await releaseReservation();
      return duplicateResult();
    }
    return { kind: "CREATED", post };
  };
}
