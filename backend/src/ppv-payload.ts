export const PPV_PROTOCOL = "onlykas" as const;
export const PPV_METADATA_VERSION = 1 as const;

export interface PpvPayload {
  protocol: typeof PPV_PROTOCOL;
  version: typeof PPV_METADATA_VERSION;
  type: "post-purchase";
  postId: string;
  mediaDigest: string;
}

export function ppvPayload(postId: string, mediaDigest: string): string {
  return Buffer.from(JSON.stringify({
    protocol: PPV_PROTOCOL,
    version: PPV_METADATA_VERSION,
    type: "post-purchase",
    postId,
    mediaDigest,
  })).toString("hex");
}

export function parsePpvPayload(payload: string | undefined): PpvPayload | null {
  if (!payload || !/^[0-9a-f]+$/i.test(payload) || payload.length % 2 !== 0) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "hex").toString("utf8")) as Record<string, unknown>;
    if (value.protocol !== PPV_PROTOCOL || value.version !== PPV_METADATA_VERSION || value.type !== "post-purchase" ||
      typeof value.postId !== "string" || value.postId.length === 0 ||
      typeof value.mediaDigest !== "string" || !/^[0-9a-f]{64}$/i.test(value.mediaDigest)) return null;
    return {
      protocol: PPV_PROTOCOL,
      version: PPV_METADATA_VERSION,
      type: "post-purchase",
      postId: value.postId,
      mediaDigest: value.mediaDigest.toLowerCase(),
    };
  } catch {
    return null;
  }
}
