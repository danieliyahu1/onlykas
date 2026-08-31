import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectStorage } from "./domain.js";

export class R2Storage implements ObjectStorage {
  private readonly client: S3Client;
  constructor(
    private readonly bucket: string,
    config: {
      endpoint: string;
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
    },
  ) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }
  async createMultipart(key: string, contentType: string): Promise<string> {
    const result = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    if (!result.UploadId) throw new Error("R2 did not create multipart upload");
    return result.UploadId;
  }
  async signPart(
    key: string,
    multipartId: string,
    partNumber: number,
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: multipartId,
        PartNumber: partNumber,
      }),
      { expiresIn: 300 },
    );
  }
  async completeMultipart(
    key: string,
    multipartId: string,
    parts: { partNumber: number; etag: string }[],
  ): Promise<void> {
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: multipartId,
        MultipartUpload: {
          Parts: parts.map((part) => ({
            PartNumber: part.partNumber,
            ETag: part.etag,
          })),
        },
      }),
    );
  }
  async download(key: string, destination: string): Promise<void> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!(result.Body instanceof Readable))
      throw new Error("R2 object unavailable");
    await pipeline(
      result.Body,
      createWriteStream(destination, { flags: "wx" }),
    );
  }
  async readRange(
    key: string,
    start?: number,
    end?: number,
  ): Promise<{ bytes: Uint8Array; size: number; contentType: string }> {
    const head = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(start === undefined
          ? {}
          : { Range: `bytes=${start}-${end ?? ""}` }),
      }),
    );
    if (!result.Body || head.ContentLength === undefined)
      throw new Error("R2 object unavailable");
    return {
      bytes: await result.Body.transformToByteArray(),
      size: head.ContentLength,
      contentType: head.ContentType ?? "application/octet-stream",
    };
  }
  async promote(sourceKey: string, destinationKey: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: destinationKey,
        CopySource: `${this.bucket}/${sourceKey}`,
        MetadataDirective: "COPY",
      }),
    );
    await this.delete(sourceKey);
  }
  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
  async abortMultipart(key: string, multipartId: string): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: multipartId,
      }),
    );
  }
}
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
