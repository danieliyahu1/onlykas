import type { Post, Upload } from "./domain.js";
import { publishPost, type PublicationRepository } from "./publish-post.js";

const creator = `kaspatest:${"q".repeat(60)}`;
const verifiedUpload: Upload = {
  id: "11111111-1111-4111-8111-111111111111",
  creator,
  stagingKey: "staging/upload",
  multipartId: "multipart",
  state: "VERIFIED",
  hintedType: "image/png",
  hintedSize: 100,
  expiresAt: 2_000,
  updatedAt: 1_000,
  error: null,
  digest: "media-digest",
  mediaType: "image/png",
  mediaSize: 100,
  finalKey: "final/media-digest",
  parts: [],
};
const command = {
  creator,
  uploadId: verifiedUpload.id,
  title: "  First light  ",
  caption: "  A private image.  ",
  priceKas: "1.00000001",
};

describe("publishPost", () => {
  it("reports success only after the publication is committed", async () => {
    let committedPost: Post | null = null;
    const repository: PublicationRepository = {
      getUpload: async () => verifiedUpload,
      commitPublication: async (uploadId, owner, post) => {
        expect(uploadId).toBe(verifiedUpload.id);
        expect(owner).toBe(creator);
        committedPost = post;
        return "COMMITTED";
      },
    };

    const outcome = await publishPost(command, {
      repository,
      createId: () => "post-id",
      now: () => 1_500,
    });

    expect(outcome).toEqual({ type: "PUBLISHED", post: committedPost });
    expect(committedPost).toEqual({
      id: "post-id",
      creator,
      title: "First light",
      caption: "A private image.",
      priceSompi: "100000001",
      mediaType: "image/png",
      mediaSize: 100,
      mediaDigest: "media-digest",
      mediaKey: "final/media-digest",
      publishedAt: 1_500,
    });
  });

  it("returns the duplicate outcome instead of phantom success", async () => {
    const repository: PublicationRepository = {
      getUpload: async () => verifiedUpload,
      commitPublication: async () => "MEDIA_DIGEST_CONFLICT",
    };

    await expect(
      publishPost(command, {
        repository,
        createId: () => "post-id",
        now: () => 1_500,
      }),
    ).resolves.toEqual({ type: "MEDIA_ALREADY_PUBLISHED" });
  });

  it("does not attempt a commit before media verification", async () => {
    let commitAttempted = false;
    const repository: PublicationRepository = {
      getUpload: async () => ({ ...verifiedUpload, state: "UPLOADED" }),
      commitPublication: async () => {
        commitAttempted = true;
        return "COMMITTED";
      },
    };

    await expect(
      publishPost(command, {
        repository,
        createId: () => "post-id",
        now: () => 1_500,
      }),
    ).resolves.toEqual({
      type: "UPLOAD_NOT_READY",
      state: "UPLOADED",
      error: null,
    });
    expect(commitAttempted).toBe(false);
  });
});
