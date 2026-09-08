import { readFile } from "node:fs/promises";
import type { ObjectStorage } from "./domain.js";

export class TestStorage implements ObjectStorage {
  readonly objects = new Map<
    string,
    { bytes: Uint8Array; contentType: string }
  >();
  readCount = 0;
  async putFile(key: string, sourcePath: string, contentType: string): Promise<void> {
    this.objects.set(key, { bytes: new Uint8Array(await readFile(sourcePath)), contentType });
  }
  async readRange(
    key: string,
    start?: number,
    end?: number,
  ): Promise<{ bytes: Uint8Array; size: number; contentType: string }> {
    this.readCount += 1;
    const object = this.objects.get(key);
    if (!object) throw new Error("missing");
    return {
      bytes: object.bytes.slice(
        start ?? 0,
        end === undefined ? undefined : end + 1,
      ),
      size: object.bytes.length,
      contentType: object.contentType,
    };
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}
