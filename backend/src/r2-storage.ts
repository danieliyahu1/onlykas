import {
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  PutObjectCommand,
  type HeadObjectCommandOutput,
  S3Client,
} from "@aws-sdk/client-s3";
import type { ObjectStorage } from "./domain.js";
import { defaultMetrics, type Metrics } from "./metrics.js";

export type StorageFailureCategory =
  | "OBJECT_NOT_FOUND"
  | "STORAGE_FORBIDDEN"
  | "STORAGE_TIMEOUT"
  | "STORAGE_FAILURE";

export class StorageError extends Error {
  constructor(
    readonly operation: string,
    readonly key: string,
    readonly category: StorageFailureCategory,
    readonly statusCode: number | undefined,
    readonly serviceCode: string | undefined,
    readonly requestId: string | undefined,
    readonly extendedRequestId: string | undefined,
    cause: unknown,
  ) {
    super(`${operation} failed for ${key}`, { cause });
    this.name = "StorageError";
  }
}

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
    private readonly metrics: Metrics = defaultMetrics,
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
  async putFile(key: string, sourcePath: string, contentType: string): Promise<void> {
    await this.metrics.observeDependency("r2", "put_object", () =>
      this.client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(sourcePath),
        ContentType: contentType,
      })),
    );
  }
  async readRange(
    key: string,
    start?: number,
    end?: number,
  ): Promise<{ bytes: Uint8Array; size: number; contentType: string }> {
    let head: HeadObjectCommandOutput;
    try {
      head = await this.metrics.observeDependency("r2", "head_object", () =>
        this.client.send(
          new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
        ),
      );
    } catch (error) {
      throw toStorageError("head_object", key, error);
    }
    let result: GetObjectCommandOutput;
    try {
      result = await this.metrics.observeDependency("r2", "get_object", () =>
        this.client.send(
          new GetObjectCommand({
            Bucket: this.bucket,
            Key: key,
            ...(start === undefined
              ? {}
              : { Range: `bytes=${start}-${end ?? ""}` }),
          }),
        ),
      );
    } catch (error) {
      throw toStorageError("get_object", key, error);
    }
    if (!result.Body || head.ContentLength === undefined)
      throw new Error("R2 object unavailable");
    return {
      bytes: await result.Body.transformToByteArray(),
      size: head.ContentLength,
      contentType: head.ContentType ?? "application/octet-stream",
    };
  }
  async delete(key: string): Promise<void> {
    await this.metrics.observeDependency("r2", "delete_object", () =>
      this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      ),
    );
  }
}

function toStorageError(
  operation: string,
  key: string,
  error: unknown,
): StorageError {
  const details = error as {
    name?: unknown;
    Code?: unknown;
    $metadata?: {
      httpStatusCode?: number;
      requestId?: string;
      extendedRequestId?: string;
    };
  };
  const statusCode = details.$metadata?.httpStatusCode;
  const serviceCode =
    typeof details.Code === "string"
      ? details.Code
      : typeof details.name === "string"
        ? details.name
        : undefined;
  return new StorageError(
    operation,
    key,
    statusCode === 404
      ? "OBJECT_NOT_FOUND"
      : statusCode === 401 || statusCode === 403
        ? "STORAGE_FORBIDDEN"
        : details.name === "TimeoutError" || details.name === "AbortError"
          ? "STORAGE_TIMEOUT"
          : "STORAGE_FAILURE",
    statusCode,
    serviceCode,
    details.$metadata?.requestId,
    details.$metadata?.extendedRequestId,
    error,
  );
}
import { createReadStream } from "node:fs";
