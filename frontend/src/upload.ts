export function uploadMedia(
  file: File,
  caption: string,
  priceKas: string,
  onProgress: (percent: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/posts/publish");
    request.setRequestHeader(
      "Content-Type",
      file.type || "application/octet-stream",
    );
    request.setRequestHeader("X-OnlyKas-Caption", caption);
    request.setRequestHeader("X-OnlyKas-Price", priceKas);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => reject(new Error("Upload failed"));
    request.onload = () => {
      let body: { id?: string; message?: string } = {};
      try {
        body = JSON.parse(request.responseText) as typeof body;
      } catch {
        // Use the generic error when the server did not return JSON.
      }
      if (request.status >= 200 && request.status < 300 && body.id)
        resolve(body.id);
      else reject(new Error(body.message ?? "Upload failed"));
    };
    request.send(file);
  });
}
