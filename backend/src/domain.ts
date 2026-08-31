import type { MediaType, UploadError, UploadState } from "@onlykas/shared";

export interface Challenge {
  id: string;
  nonce: string;
  address: string;
  origin: string;
  network: string;
  message: string;
  expiresAt: number;
  consumedAt: number | null;
}

export interface Session {
  id: string;
  address: string;
  expiresAt: number;
}

export interface Upload {
  id: string;
  creator: string;
  stagingKey: string;
  multipartId: string;
  state: UploadState;
  hintedType: string;
  hintedSize: number;
  expiresAt: number;
  updatedAt: number;
  error: UploadError;
  digest: string | null;
  mediaType: MediaType | null;
  mediaSize: number | null;
  finalKey: string | null;
  parts: { partNumber: number; etag: string }[];
}

export interface Post {
  id: string;
  creator: string;
  title: string;
  description: string;
  priceSompi: string;
  mediaType: MediaType;
  mediaSize: number;
  mediaDigest: string;
  mediaKey: string;
  publishedAt: number;
}

export interface Store {
  initialize(): Promise<void>;
  createChallenge(challenge: Challenge): Promise<void>;
  consumeChallenge(id: string, now: number): Promise<Challenge | null>;
  createSession(session: Session): Promise<void>;
  getSession(id: string, now: number): Promise<Session | null>;
  rollSession(id: string, expiresAt: number): Promise<void>;
  deleteSession(id: string): Promise<void>;
  createUpload(upload: Upload): Promise<void>;
  getUpload(id: string): Promise<Upload | null>;
  updateUpload(upload: Upload): Promise<void>;
  claimUpload(now: number, staleBefore: number): Promise<Upload | null>;
  expiredUploads(now: number): Promise<Upload[]>;
  publish(uploadId: string, post: Post): Promise<boolean>;
  getPost(id: string): Promise<Post | null>;
  creatorPosts(address: string): Promise<Post[]>;
}

export interface ObjectStorage {
  createMultipart(key: string, contentType: string): Promise<string>;
  signPart(
    key: string,
    multipartId: string,
    partNumber: number,
  ): Promise<string>;
  completeMultipart(
    key: string,
    multipartId: string,
    parts: { partNumber: number; etag: string }[],
  ): Promise<void>;
  download(key: string, destination: string): Promise<void>;
  readRange(
    key: string,
    start?: number,
    end?: number,
  ): Promise<{ bytes: Uint8Array; size: number; contentType: string }>;
  promote(sourceKey: string, destinationKey: string): Promise<void>;
  delete(key: string): Promise<void>;
  abortMultipart(key: string, multipartId: string): Promise<void>;
}

export interface WalletVerifier {
  verify(
    message: string,
    signature: string,
    publicKey: string,
    address: string,
  ): Promise<boolean>;
}
