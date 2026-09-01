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

export interface Profile {
  address: string;
  displayName: string | null;
  updatedAt: number;
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
  caption: string;
  priceSompi: string;
  mediaType: MediaType;
  mediaSize: number;
  mediaDigest: string;
  mediaKey: string;
  publishedAt: number;
}

export type PaymentAttemptState =
  "PREPARED" | "PENDING" | "CONFIRMED" | "REJECTED";
export interface PaymentAttempt {
  id: string;
  postId: string;
  buyer: string;
  amountSompi: string;
  creator: string;
  preparedTransaction: string;
  fingerprint: string;
  signedTransactionId: string | null;
  state: PaymentAttemptState;
  rejection: string | null;
  submittedAt: number | null;
  lastCheckedAt: number | null;
  reconciliationAttempts: number;
  createdAt: number;
  updatedAt: number;
}
export interface Purchase {
  postId: string;
  buyer: string;
  transactionId: string;
  confirmedAt: number;
}
export interface PreparedPayment {
  transaction: string;
  fingerprint: string;
  amountSompi: string;
  creator: string;
}
export interface PaymentSubmission {
  isAccepted: boolean | null;
  transactionId: string | null;
  rejection: string | null;
}
export interface PaymentGateway {
  prepare(post: Post, buyer: string): Promise<PreparedPayment>;
  submit(
    prepared: PreparedPayment,
    signedTransaction: string,
  ): Promise<PaymentSubmission>;
  status(transactionId: string): Promise<PaymentSubmission>;
}

export type PaymentAttemptUpdate = Partial<
  Pick<
    PaymentAttempt,
    | "signedTransactionId"
    | "state"
    | "rejection"
    | "submittedAt"
    | "lastCheckedAt"
    | "reconciliationAttempts"
    | "updatedAt"
  >
>;

export interface Store {
  initialize(): Promise<void>;
  createChallenge(challenge: Challenge): Promise<void>;
  consumeChallenge(id: string, now: number): Promise<Challenge | null>;
  createSession(session: Session): Promise<void>;
  getSession(id: string, now: number): Promise<Session | null>;
  rollSession(id: string, expiresAt: number): Promise<void>;
  deleteSession(id: string): Promise<void>;
  getProfile(address: string): Promise<Profile | null>;
  saveProfile(profile: Profile): Promise<void>;
  searchCreators(name: string, limit: number): Promise<Profile[]>;
  createUpload(upload: Upload): Promise<void>;
  getUpload(id: string): Promise<Upload | null>;
  updateUpload(upload: Upload): Promise<void>;
  claimUpload(now: number, staleBefore: number): Promise<Upload | null>;
  expiredUploads(now: number): Promise<Upload[]>;
  commitPublication(
    uploadId: string,
    creator: string,
    post: Post,
  ): Promise<CommitPublicationResult>;
  getPost(id: string): Promise<Post | null>;
  creatorPosts(address: string): Promise<Post[]>;
  createPaymentAttempt(attempt: PaymentAttempt): Promise<void>;
  getPaymentAttempt(id: string): Promise<PaymentAttempt | null>;
  unresolvedPaymentAttempt(
    postId: string,
    buyer: string,
  ): Promise<PaymentAttempt | null>;
  pendingPaymentAttempts(): Promise<PaymentAttempt[]>;
  compareAndSetPaymentAttempt(
    id: string,
    expectedState: PaymentAttemptState,
    update: PaymentAttemptUpdate,
  ): Promise<PaymentAttempt | null>;
  confirmPaymentAttempt(
    id: string,
    expectedState: PaymentAttemptState,
    purchase: Purchase,
  ): Promise<PaymentAttempt | null>;
  createPurchase(purchase: Purchase): Promise<boolean>;
  hasPurchase(postId: string, buyer: string): Promise<boolean>;
}

export type CommitPublicationResult =
  "COMMITTED" | "MEDIA_DIGEST_CONFLICT" | "UPLOAD_STATE_CONFLICT";

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
