import { uploadMedia } from "./upload.js";

type ProgressHandler = (event: ProgressEvent) => void;

class FakeRequest {
  static last: FakeRequest;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  responseHeaders: Record<string, string> = {};
  status = 0;
  responseText = "";
  body: unknown = undefined;
  upload: { onprogress: ProgressHandler | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    FakeRequest.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  getResponseHeader(name: string) {
    return this.responseHeaders[name] ?? null;
  }
  send(body?: unknown) {
    this.body = body;
  }
}

function file() {
  return new File(["image"], "moment.png", { type: "image/png" });
}

describe("uploadMedia", () => {
  beforeEach(() => {
    vi.stubGlobal("XMLHttpRequest", FakeRequest);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects with the server's code, status, and request id", async () => {
    const promise = uploadMedia(file(), "Caption", "1", () => {});
    const request = FakeRequest.last;
    request.status = 502;
    request.responseText = JSON.stringify({
      error: "MEDIA_STORAGE_FAILED",
      message: "Media storage is unavailable.",
      requestId: "trace-1",
    });
    request.onload?.();

    await expect(promise).rejects.toMatchObject({
      name: "ApiError",
      code: "MEDIA_STORAGE_FAILED",
      status: 502,
      requestId: "trace-1",
      message: "Media storage is unavailable.",
    });
  });

  it("uses the response header when the body carries no request id", async () => {
    const promise = uploadMedia(file(), "Caption", "1", () => {});
    const request = FakeRequest.last;
    request.status = 503;
    request.responseText = JSON.stringify({
      error: "SERVICE_UNAVAILABLE",
      message: "Server is down.",
    });
    request.responseHeaders["x-request-id"] = "header-trace";
    request.onload?.();

    await expect(promise).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      requestId: "header-trace",
    });
  });

  it("still resolves an already published duplicate", async () => {
    const promise = uploadMedia(file(), "Caption", "1", () => {});
    const request = FakeRequest.last;
    request.status = 409;
    request.responseText = JSON.stringify({ id: "existing-post" });
    request.onload?.();

    await expect(promise).resolves.toEqual({
      id: "existing-post",
      duplicate: true,
    });
  });

  it("carries a multi-line, non-ASCII caption in the body without headers", async () => {
    const caption = "Line one\nLine two 🎉 — naïve";
    const promise = uploadMedia(file(), caption, "1", () => {});
    const request = FakeRequest.last;

    const body = request.body as FormData;
    expect(body.get("caption")).toBe(caption);
    expect(body.get("price")).toBe("1");
    expect((body.get("media") as File).name).toBe("moment.png");
    expect(request.headers).toEqual({});

    request.status = 201;
    request.responseText = JSON.stringify({ id: "new-post" });
    request.onload?.();

    await expect(promise).resolves.toEqual({ id: "new-post", duplicate: false });
  });
});
