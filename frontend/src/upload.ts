import { api } from "./kasware.js";
import type { UploadResponse } from "@onlykas/shared";

const partSize = 8 * 1024 * 1024;

export async function uploadMedia(
  file: File,
  onProgress: (percent: number) => void,
): Promise<string> {
  const upload = await api<UploadResponse>("/api/uploads", {
    method: "POST",
    body: JSON.stringify({ name: file.name, type: file.type, size: file.size }),
  });
  const parts: { partNumber: number; etag: string }[] = [];
  const count = Math.ceil(file.size / partSize);
  for (let index = 0; index < count; index += 1) {
    const partNumber = index + 1;
    console.info("[OnlyKas upload] requesting part URL", {
      uploadId: upload.id,
      partNumber,
      partCount: count,
    });
    const signed = await api<{ url: string }>(
      `/api/uploads/${upload.id}/parts`,
      { method: "POST", body: JSON.stringify({ partNumber }) },
    );
    const start = index * partSize;
    const blob = file.slice(start, Math.min(file.size, start + partSize));
    console.info("[OnlyKas upload] uploading part", {
      uploadId: upload.id,
      partNumber,
      size: blob.size,
    });
    const etag = await putPart(signed.url, blob, (loaded) =>
      onProgress(Math.round(((start + loaded) / file.size) * 100)),
    );
    console.info("[OnlyKas upload] part uploaded", {
      uploadId: upload.id,
      partNumber,
      etagLength: etag.length,
    });
    parts.push({ partNumber, etag });
  }
  console.info("[OnlyKas upload] completing upload", {
    uploadId: upload.id,
    partCount: parts.length,
  });
  await api(`/api/uploads/${upload.id}/complete`, {
    method: "POST",
    body: JSON.stringify({ parts }),
  });
  return upload.id;
}

function putPart(
  url: string,
  blob: Blob,
  progress: (loaded: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.upload.onprogress = (event) => progress(event.loaded);
    request.onerror = () => {
      console.error("[OnlyKas upload] part request failed", {
        status: request.status,
        size: blob.size,
      });
      reject(new Error("Upload failed"));
    };
    request.onload = () => {
      const etag = request.getResponseHeader("ETag");
      if (request.status < 200 || request.status >= 300 || !etag) {
        console.error("[OnlyKas upload] part response invalid", {
          status: request.status,
          hasEtag: Boolean(etag),
          size: blob.size,
        });
        reject(new Error("Upload failed"));
      } else {
        resolve(etag);
      }
    };
    request.send(blob);
  });
}

export async function waitForVerification(
  uploadId: string,
): Promise<UploadResponse> {
  for (;;) {
    const upload = await api<UploadResponse>(`/api/uploads/${uploadId}`);
    if (
      upload.state === "VERIFIED" ||
      upload.state === "REJECTED" ||
      upload.state === "EXPIRED"
    )
      return upload;
    await new Promise((resolve) => window.setTimeout(resolve, 1_000));
  }
}
