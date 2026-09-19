import type { Post } from "../domain/models.js";
import { logger as defaultLogger, safeError, type Logger } from "../observability.js";
import type { ObjectStorage, PostRepository } from "./ports.js";

export type DeletePostResult =
  | { kind: "DELETED"; post: Post }
  | { kind: "NOT_FOUND" }
  | { kind: "FORBIDDEN" };

export function createDeletePostUseCase(dependencies: {
  posts: Pick<PostRepository, "getPost" | "deletePost">;
  storage: Pick<ObjectStorage, "delete">;
  logger?: Logger;
}): (postId: string, requester: string) => Promise<DeletePostResult> {
  const logger = dependencies.logger ?? defaultLogger;
  return async (postId, requester) => {
    const post = await dependencies.posts.getPost(postId);
    if (!post) return { kind: "NOT_FOUND" };
    if (post.creator !== requester) return { kind: "FORBIDDEN" };
    const deleted = await dependencies.posts.deletePost(post.id);
    if (!deleted) return { kind: "NOT_FOUND" };
    await dependencies.storage.delete(deleted.mediaKey).catch((error) => {
      logger.error("post_media_delete_failed", {
        postId: deleted.id,
        mediaKey: deleted.mediaKey,
        ...safeError(error),
      });
    });
    return { kind: "DELETED", post: deleted };
  };
}
