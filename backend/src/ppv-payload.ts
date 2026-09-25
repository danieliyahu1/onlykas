export const PPV_PROTOCOL = "kaskama" as const;
export const PPV_METADATA_VERSION = 1 as const;
export const PPV_HASH_ALGORITHM = "blake3-256" as const;
export const PPV_HASH_ENCODING = "hex" as const;

export interface PpvMediaHash {
  algorithm: typeof PPV_HASH_ALGORITHM;
  encoding: typeof PPV_HASH_ENCODING;
  digest: string;
}

export interface PpvPayload {
  protocol: typeof PPV_PROTOCOL;
  version: typeof PPV_METADATA_VERSION;
  type: "post-purchase";
  postId: string;
  mediaHash: PpvMediaHash;
}

export function ppvPayload(postId: string, digest: string): string {
  return Buffer.from(JSON.stringify({
    protocol: PPV_PROTOCOL,
    version: PPV_METADATA_VERSION,
    type: "post-purchase",
    postId,
    mediaHash: {
      algorithm: PPV_HASH_ALGORITHM,
      encoding: PPV_HASH_ENCODING,
      digest: digest.toLowerCase(),
    },
  })).toString("hex");
}

export function parsePpvPayload(payload: string | undefined): PpvPayload | null {
  if (!payload || !/^[0-9a-f]+$/i.test(payload) || payload.length % 2 !== 0) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "hex").toString("utf8")) as Record<string, unknown>;
    if (value.protocol !== PPV_PROTOCOL || value.version !== PPV_METADATA_VERSION || value.type !== "post-purchase" ||
      typeof value.postId !== "string" || value.postId.length === 0) return null;
    const mediaHash = parseMediaHash(value);
    if (!mediaHash) return null;
    return {
      protocol: PPV_PROTOCOL,
      version: PPV_METADATA_VERSION,
      type: "post-purchase",
      postId: value.postId,
      mediaHash,
    };
  } catch {
    return null;
  }
}

function parseMediaHash(value: Record<string, unknown>): PpvMediaHash | null {
  const hash = value.mediaHash as Record<string, unknown> | undefined;
  if (hash) {
    if (hash.algorithm !== PPV_HASH_ALGORITHM || hash.encoding !== PPV_HASH_ENCODING) return null;
    if (typeof hash.digest !== "string" || !/^[0-9a-f]{64}$/i.test(hash.digest)) return null;
    return {
      algorithm: PPV_HASH_ALGORITHM,
      encoding: PPV_HASH_ENCODING,
      digest: hash.digest.toLowerCase(),
    };
  }
  // Version 1 payloads published before the self-describing hash wrote the
  // digest as a bare string and always used BLAKE3-256 hex.
  if (typeof value.mediaDigest === "string" && /^[0-9a-f]{64}$/i.test(value.mediaDigest)) {
    return {
      algorithm: PPV_HASH_ALGORITHM,
      encoding: PPV_HASH_ENCODING,
      digest: value.mediaDigest.toLowerCase(),
    };
  }
  return null;
}
