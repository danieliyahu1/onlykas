import { MemoryStore } from "../memory-store.js";
import type { Post } from "../domain/models.js";
import { createPublishPostUseCase } from "./publication-use-cases.js";

const media = {
  digest: "a".repeat(64),
  mediaType: "image/jpeg" as const,
  size: 3,
};

function storage(
  overrides: Partial<{
    putFile: () => Promise<void>;
    delete: () => Promise<void>;
  }> = {},
) {
  return {
    putFile: overrides.putFile ?? (async () => undefined),
    delete: overrides.delete ?? (async () => undefined),
  };
}

describe("publish post use case", () => {
  it("reserves a digest before upload and never uploads a duplicate", async () => {
    const store = new MemoryStore();
    let uploads = 0;
    const publish = createPublishPostUseCase({
      posts: store,
      storage: storage({ putFile: async () => void uploads++ }),
      verifyMedia: async () => media,
      createId: () => "post-1",
      pendingTtlMs: 60_000,
    });

    expect(
      await publish({
        creator: "creator",
        caption: "caption",
        priceSompi: "100",
        sourcePath: "media",
        now: 1_000,
      }),
    ).toMatchObject({ kind: "CREATED" });
    expect(
      await publish({
        creator: "creator",
        caption: "caption",
        priceSompi: "100",
        sourcePath: "media",
        now: 1_000,
      }),
    ).toMatchObject({ kind: "DUPLICATE", post: { id: "post-1" } });
    expect(uploads).toBe(1);
  });

  it("names media by creator so two creators can store the same digest", async () => {
    const store = new MemoryStore();
    const publish = createPublishPostUseCase({
      posts: store,
      storage: storage(),
      verifyMedia: async () => media,
      createId: () => "post-1",
      pendingTtlMs: 60_000,
    });

    const first = await publish({
      creator: "creator-a",
      caption: "caption",
      priceSompi: "100",
      sourcePath: "media",
      now: 1_000,
    });
    const second = await publish({
      creator: "creator-b",
      caption: "caption",
      priceSompi: "100",
      sourcePath: "media",
      now: 1_000,
    });

    expect(first).toMatchObject({
      kind: "CREATED",
      post: { mediaKey: `media/creator-a/aa/${media.digest}` },
    });
    expect(second).toMatchObject({
      kind: "CREATED",
      post: { mediaKey: `media/creator-b/aa/${media.digest}` },
    });
  });

  it("releases an abandoned reservation and attempts cleanup after storage failure", async () => {
    const store = new MemoryStore();
    let deleted = 0;
    const publish = createPublishPostUseCase({
      posts: store,
      storage: storage({
        putFile: async () => {
          throw new Error("storage unavailable");
        },
        delete: async () => void deleted++,
      }),
      verifyMedia: async () => media,
      createId: () => "post-1",
      pendingTtlMs: 60_000,
    });

    await expect(
      publish({
        creator: "creator",
        caption: "caption",
        priceSompi: "100",
        sourcePath: "media",
        now: 1_000,
      }),
    ).rejects.toThrow("storage unavailable");
    expect(store.pendingPosts.size).toBe(0);
    expect(deleted).toBe(1);
  });

  it("releases the reservation and returns the existing post when the commit is a duplicate", async () => {
    const existing: Post = {
      id: "post-0",
      creator: "creator",
      caption: "caption",
      priceSompi: "100",
      mediaType: "image/jpeg",
      mediaSize: 3,
      mediaDigest: media.digest,
      mediaKey: "media",
      publishedAt: 0,
    };
    const released: string[] = [];
    const publish = createPublishPostUseCase({
      posts: {
        prunePendingPublications: async () => undefined,
        reservePublication: async () => "RESERVED",
        commitPublication: async () => "DUPLICATE",
        releasePublication: async (id) => void released.push(id),
        findPostByMedia: async () => existing,
      },
      storage: storage(),
      verifyMedia: async () => media,
      createId: () => "post-1",
      pendingTtlMs: 60_000,
    });

    const result = await publish({
      creator: "creator",
      caption: "caption",
      priceSompi: "100",
      sourcePath: "media",
      now: 1_000,
    });

    expect(result).toEqual({ kind: "DUPLICATE", post: existing });
    expect(released).toEqual(["post-1"]);
  });

  it("releases the reservation when the commit fails", async () => {
    const released: string[] = [];
    const publish = createPublishPostUseCase({
      posts: {
        prunePendingPublications: async () => undefined,
        reservePublication: async () => "RESERVED",
        commitPublication: async () => {
          throw new Error("database unavailable");
        },
        releasePublication: async (id) => void released.push(id),
        findPostByMedia: async () => null,
      },
      storage: storage(),
      verifyMedia: async () => media,
      createId: () => "post-1",
      pendingTtlMs: 60_000,
    });

    await expect(
      publish({
        creator: "creator",
        caption: "caption",
        priceSompi: "100",
        sourcePath: "media",
        now: 1_000,
      }),
    ).rejects.toThrow("database unavailable");
    expect(released).toEqual(["post-1"]);
  });
});
