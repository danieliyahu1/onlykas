import type { ObjectStorage } from "./domain.js";

export class TestStorage implements ObjectStorage {
  readonly objects = new Map<
    string,
    { bytes: Uint8Array; contentType: string }
  >();
  readCount = 0;
  async createMultipart(key: string, contentType: string): Promise<string> {
    this.objects.set(key, { bytes: new Uint8Array(), contentType });
    return `multipart-${key}`;
  }
  async signPart(
    key: string,
    _multipartId: string,
    partNumber: number,
  ): Promise<string> {
    return `https://uploads.test/${key}/${partNumber}`;
  }
  async completeMultipart(): Promise<void> {}
  async download(key: string, destination: string): Promise<void> {
    this.readCount += 1;
    const object = this.objects.get(key);
    if (!object) throw new Error("missing");
    await writeFile(destination, object.bytes, { flag: "wx" });
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
  async promote(sourceKey: string, destinationKey: string): Promise<void> {
    const object = this.objects.get(sourceKey);
    if (!object) throw new Error("missing");
    this.objects.set(destinationKey, object);
    this.objects.delete(sourceKey);
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
  async abortMultipart(key: string): Promise<void> {
    this.objects.delete(key);
  }
}
import { writeFile } from "node:fs/promises";
