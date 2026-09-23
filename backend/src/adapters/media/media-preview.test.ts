import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { ObjectStorage } from "../../application/ports.js";
import type { Logger } from "../../observability.js";
import {
  createMediaPreview,
  renderPreview,
} from "./media-preview.js";

const post = {
  id: "post-1",
  mediaKey: "media/creator/ab/digest",
  mediaType: "image/jpeg" as const,
};

const consoleLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function fakeStorage(initial: Record<string, Uint8Array> = {}) {
  const objects = new Map<string, Uint8Array>(Object.entries(initial));
  const puts: string[] = [];
  const storage: Pick<ObjectStorage, "readRange" | "putFile"> = {
    async readRange(key) {
      const bytes = objects.get(key);
      if (!bytes) throw new Error("missing");
      return {
        bytes,
        size: bytes.byteLength,
        contentType: "application/octet-stream",
      };
    },
    async putFile(key, sourcePath) {
      puts.push(key);
      objects.set(key, new Uint8Array(readFileSync(sourcePath)));
    },
  };
  return { storage, objects, puts };
}

describe("media preview", () => {
  it("generates the preview once and serves the stored copy afterwards", async () => {
    let renders = 0;
    const store = fakeStorage({ "media/creator/ab/digest": new Uint8Array([1, 2, 3]) });
    const preview = createMediaPreview({
      storage: store.storage,
      logger: consoleLogger,
      render: async (_source, _mediaType, output) => {
        renders += 1;
        await writeFile(output, new Uint8Array([9, 9]));
      },
    });

    const first = await preview.ensure(post);
    expect(first && Array.from(first)).toEqual([9, 9]);
    expect(store.objects.has("previews/v8/creator/ab/digest.jpg")).toBe(true);

    const second = await preview.ensure(post);
    expect(second && Array.from(second)).toEqual([9, 9]);
    expect(renders).toBe(1);
    expect(store.puts).toEqual(["previews/v8/creator/ab/digest.jpg"]);
  });

  it("returns null and stores nothing when rendering fails", async () => {
    const store = fakeStorage({ "media/creator/ab/digest": new Uint8Array([1]) });
    const preview = createMediaPreview({
      storage: store.storage,
      logger: consoleLogger,
      render: async () => {
        throw new Error("cannot decode");
      },
    });

    await expect(preview.ensure(post)).resolves.toBeNull();
    expect(store.puts).toEqual([]);
    expect(store.objects.has("previews/v8/creator/ab/digest.jpg")).toBe(false);
  });

  it("coalesces concurrent requests for the same preview into one render", async () => {
    let renders = 0;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store = fakeStorage({ "media/creator/ab/digest": new Uint8Array([1]) });
    const preview = createMediaPreview({
      storage: store.storage,
      logger: consoleLogger,
      render: async (_source, _mediaType, output) => {
        renders += 1;
        await gate;
        await writeFile(output, new Uint8Array([7]));
      },
    });

    const first = preview.ensure(post);
    const second = preview.ensure(post);
    release();
    const [a, b] = await Promise.all([first, second]);

    expect(renders).toBe(1);
    expect(a && Array.from(a)).toEqual([7]);
    expect(b && Array.from(b)).toEqual([7]);
    expect(store.puts).toEqual(["previews/v8/creator/ab/digest.jpg"]);
  });

  it("renders any image into a blurred JPEG that keeps its aspect ratio", async () => {
    const dir = await mkdtemp(join(tmpdir(), "onlykas-preview-test-"));
    const source = join(dir, "source.png");
    const output = join(dir, "preview.jpg");
    try {
      await sharp({
        create: {
          width: 1080,
          height: 1920,
          channels: 3,
          background: { r: 200, g: 40, b: 40 },
        },
      })
        .png()
        .toFile(source);

      await renderPreview(source, "image/jpeg", output, "ffmpeg");

      const meta = await sharp(output).metadata();
      expect(meta.format).toBe("jpeg");
      expect(meta.height).toBe(300);
      expect(meta.width).toBe(169);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
