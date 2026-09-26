import { ApiError, toApiError, type ApiErrorBody } from "./api-error.js";
import { COPY } from "./copy.js";
import { logger } from "./logger.js";

export interface UploadResult {
  id: string;
  duplicate: boolean;
}

type UploadBody = ApiErrorBody & { id?: string };

export function uploadMedia(
  file: File,
  caption: string,
  priceKas: string,
  onProgress: (percent: number) => void,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/posts/publish");
    // The caption is free text and may span lines or hold any Unicode
    // character, so it travels in the multipart body rather than a header.
    const body = new FormData();
    body.append("caption", caption);
    body.append("price", priceKas);
    body.append("media", file, file.name);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () =>
      reject(new ApiError("SERVER_UNAVAILABLE", COPY.serverDown, 0));
    request.onload = () => {
      let body: UploadBody = {};
      try {
        body = JSON.parse(request.responseText) as UploadBody;
      } catch {
        // Use the generic error when the server did not return JSON.
      }
      if (request.status >= 200 && request.status < 300 && body.id) {
        resolve({ id: body.id, duplicate: false });
        return;
      }
      if (request.status === 409 && body.id) {
        resolve({ id: body.id, duplicate: true });
        return;
      }
      const error = toApiError(request.status, {
        ...body,
        requestId:
          body.requestId ??
          request.getResponseHeader("x-request-id") ??
          undefined,
      });
      logger.error("upload_failed", {
        status: request.status,
        code: error.code,
        message: error.message,
        requestId: error.requestId,
      });
      reject(error);
    };
    request.send(body);
  });
}
