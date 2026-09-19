import { createDeletePostUseCase } from "./delete-post.js";
import type { Post } from "../domain/models.js";

const creator = "kaspatest:creator";
const other = "kaspatest:other";

function existingPost(overrides: Partial<Post> = {}): Post {
  return {
    id: "post-1",
    creator,
    caption: "caption",
    priceSompi: "100",
    mediaType: "image/jpeg",
    mediaSize: 3,
    mediaDigest: "digest",
    mediaKey: "media/creator/ab/digest",
    publishedAt: 0,
    ...overrides,
  };
}

function harness(post: Post | null) {
  const deletedPosts: string[] = [];
  const removedMedia: string[] = [];
  const useCase = createDeletePostUseCase({
    posts: {
      getPost: async () => post,
      deletePost: async (id) => {
        deletedPosts.push(id);
        return post;
      },
    },
    storage: { delete: async (key) => void removedMedia.push(key) },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  return { useCase, deletedPosts, removedMedia };
}

describe("delete post use case", () => {
  it("deletes the owner's post and its media", async () => {
    const { useCase, deletedPosts, removedMedia } = harness(existingPost());

    const result = await useCase("post-1", creator);

    expect(result).toEqual({ kind: "DELETED", post: existingPost() });
    expect(deletedPosts).toEqual(["post-1"]);
    expect(removedMedia).toEqual(["media/creator/ab/digest"]);
  });

  it("refuses to delete another creator's post", async () => {
    const { useCase, deletedPosts, removedMedia } = harness(existingPost());

    await expect(useCase("post-1", other)).resolves.toEqual({ kind: "FORBIDDEN" });
    expect(deletedPosts).toEqual([]);
    expect(removedMedia).toEqual([]);
  });

  it("reports a missing post", async () => {
    const { useCase } = harness(null);

    await expect(useCase("missing", creator)).resolves.toEqual({ kind: "NOT_FOUND" });
  });
});
