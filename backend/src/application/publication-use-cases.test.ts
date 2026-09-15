import { MemoryStore } from "../memory-store.js";
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
    ).toEqual({ kind: "DUPLICATE" });
    expect(uploads).toBe(1);
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
});
