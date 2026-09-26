import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import Busboy from "busboy";
import type { Request } from "express";
import { MediaValidationError } from "../media/media.js";

/** The text fields and media bytes parsed from a publish upload request. */
export interface PublishMedia {
  caption: string;
  price: string;
  bytesWritten: number;
}

/** The request was not a well-formed single-file publish upload. */
export class InvalidPublishUploadError extends Error {
  constructor() {
    super("INVALID_PUBLISH_UPLOAD");
  }
}

/**
 * Streams a multipart publish request: the `media` file is written to
 * `filePath` while the `caption` and `price` text fields are collected. The
 * request body is the only place free-form caption text may travel; HTTP
 * headers are single-line and cannot carry it faithfully.
 */
export function readPublishMedia(
  request: Request,
  options: { filePath: string; maxBytes: number },
): Promise<PublishMedia> {
  return new Promise((resolve, reject) => {
    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({
        headers: request.headers,
        limits: {
          files: 1,
          fileSize: options.maxBytes,
          fields: 2,
          fieldSize: 4096,
        },
      });
    } catch {
      reject(new InvalidPublishUploadError());
      return;
    }

    let settled = false;
    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      parser.destroy();
      request.unpipe(parser);
      request.resume();
      action();
    };

    let caption: string | undefined;
    let price: string | undefined;
    let bytesWritten = 0;
    let mediaSeen = false;
    let limitExceeded = false;
    let fileWrite: Promise<void> | undefined;

    parser.on("field", (name, value) => {
      if (name === "caption") caption = value;
      else if (name === "price") price = value;
    });

    parser.on("file", (name, stream) => {
      if (settled) {
        stream.resume();
        return;
      }
      if (name !== "media" || mediaSeen) {
        stream.resume();
        settle(() => reject(new InvalidPublishUploadError()));
        return;
      }
      mediaSeen = true;
      stream.on("data", (chunk: Buffer) => {
        bytesWritten += chunk.byteLength;
      });
      stream.on("limit", () => {
        limitExceeded = true;
      });
      fileWrite = pipeline(
        stream,
        createWriteStream(options.filePath, { flags: "wx" }),
      );
    });

    parser.on("filesLimit", () => settle(() => reject(new InvalidPublishUploadError())));
    parser.on("fieldsLimit", () => settle(() => reject(new InvalidPublishUploadError())));
    parser.on("error", () => settle(() => reject(new InvalidPublishUploadError())));

    parser.on("close", () => {
      void (async () => {
        if (fileWrite) {
          try {
            await fileWrite;
          } catch {
            settle(() => reject(new InvalidPublishUploadError()));
            return;
          }
        }
        if (limitExceeded) {
          settle(() => reject(new MediaValidationError("VIDEO_TOO_LARGE")));
          return;
        }
        if (!mediaSeen) {
          settle(() => reject(new InvalidPublishUploadError()));
          return;
        }
        settle(() =>
          resolve({ caption: caption ?? "", price: price ?? "", bytesWritten }),
        );
      })();
    });

    request.pipe(parser);
  });
}
