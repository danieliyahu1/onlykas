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
  getCovenant(id: string): Promise<MembershipCovenant | null>;
  saveCovenant(covenant: MembershipCovenant): Promise<void>;
  createMembershipOffer(offer: MembershipOffer): Promise<void>;
  getMembershipOffer(id: string): Promise<MembershipOffer | null>;
  creatorMembershipOffers(creator: string): Promise<MembershipOffer[]>;
  createMembershipOfferDeploy(deploy: MembershipOfferDeploy): Promise<void>;
  getMembershipOfferDeploy(id: string): Promise<MembershipOfferDeploy | null>;
  unresolvedMembershipOfferDeploy(
    creator: string,
  ): Promise<MembershipOfferDeploy | null>;
  pendingMembershipOfferDeploys(): Promise<MembershipOfferDeploy[]>;
  compareAndSetMembershipOfferDeploy(
    id: string,
    expectedState: MembershipOfferDeployState,
    update: MembershipOfferDeployUpdate,
  ): Promise<MembershipOfferDeploy | null>;
  confirmMembershipOfferDeploy(
    id: string,
    expectedState: MembershipOfferDeployState,
    offer: MembershipOffer,
    transactionId: string,
  ): Promise<MembershipOfferDeploy | null>;
  createMembership(membership: Membership): Promise<void>;
  getMembership(id: string): Promise<Membership | null>;
  ownerMemberships(owner: string): Promise<Membership[]>;
  activeMembershipForPost(postId: string, viewer: string): Promise<boolean>;
  createMembershipTransferAttempt(
    attempt: MembershipTransferAttempt,
  ): Promise<void>;
  getMembershipTransferAttempt(
    id: string,
  ): Promise<MembershipTransferAttempt | null>;
  pendingMembershipTransferAttempts(): Promise<MembershipTransferAttempt[]>;
  compareAndSetMembershipTransferAttempt(
    id: string,
    expectedState: MembershipTransferAttemptState,
    update: MembershipTransferAttemptUpdate,
  ): Promise<MembershipTransferAttempt | null>;
  confirmMembershipTransferAttempt(
    id: string,
    expectedState: MembershipTransferAttemptState,
    membershipUpdate: { transactionId: string; confirmedAt: number },
  ): Promise<MembershipTransferAttempt | null>;
  createMembershipMintAttempt(attempt: MembershipMintAttempt): Promise<void>;
  getMembershipMintAttempt(id: string): Promise<MembershipMintAttempt | null>;
  unresolvedMembershipMintAttempt(
    offerId: string,
    buyer: string,
  ): Promise<MembershipMintAttempt | null>;
  pendingMembershipMintAttempts(): Promise<MembershipMintAttempt[]>;
  compareAndSetMembershipMintAttempt(
    id: string,
    expectedState: MembershipMintAttemptState,
    update: MembershipMintAttemptUpdate,
  ): Promise<MembershipMintAttempt | null>;
  confirmMembershipMintAttempt(
    id: string,
    expectedState: MembershipMintAttemptState,
    membership: Membership,
  ): Promise<MembershipMintAttempt | null>;
  offerMemberships(offerId: string, owner: string): Promise<Membership[]>;
  expireMemberships(now: number): Promise<number>;
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

export interface MembershipCovenant {
  id: string;
  templateJson: string;
  templateFingerprint: string;
  amount: string;
  durationMs: number;
  creatorRoyaltyBps: number;
  createdAt: number;
}

export interface MembershipOffer {
  id: string;
  creator: string;
  covenantId: string;
  priceSompi: string;
  description: string;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export type MembershipState = "ACTIVE" | "EXPIRED" | "TRANSFERRED";

export type MembershipOfferDeployState =
  "PREPARED" | "PENDING" | "CONFIRMED" | "REJECTED";

export interface MembershipOfferDeploy {
  id: string;
  creator: string;
  priceSompi: string;
  description: string;
  covenantId: string;
  payoutPk: string;
  preparedTransaction: string;
  fingerprint: string;
  signedTransactionId: string | null;
  state: MembershipOfferDeployState;
  rejection: string | null;
  submittedAt: number | null;
  lastCheckedAt: number | null;
  reconciliationAttempts: number;
  createdAt: number;
  updatedAt: number;
}

export type MembershipOfferDeployUpdate = Partial<
  Pick<
    MembershipOfferDeploy,
    | "signedTransactionId"
    | "state"
    | "rejection"
    | "submittedAt"
    | "lastCheckedAt"
    | "reconciliationAttempts"
    | "updatedAt"
  >
>;

export interface Membership {
  id: string;
  offerId: string;
  owner: string;
  creator: string;
  covenantId: string;
  createdTxId: string | null;
  validUntil: number;
  state: MembershipState;
  createdAt: number;
  updatedAt: number;
}

export type MembershipTransferAttemptState =
  "PREPARED" | "PENDING" | "CONFIRMED" | "REJECTED";

export interface MembershipTransferAttempt {
  id: string;
  membershipId: string;
  seller: string;
  buyer: string;
  saleAmountSompi: string;
  creatorRoyaltySompi: string;
  creatorPayoutAddress: string;
  preparedTransaction: string;
  fingerprint: string;
  signedTransactionId: string | null;
  state: MembershipTransferAttemptState;
  rejection: string | null;
  submittedAt: number | null;
  lastCheckedAt: number | null;
  reconciliationAttempts: number;
  createdAt: number;
  updatedAt: number;
}

export interface PreparedMembershipTransfer {
  transaction: string;
  fingerprint: string;
  saleAmountSompi: string;
  creatorRoyaltySompi: string;
  seller: string;
  buyer: string;
}

export interface PreparedMembershipDeploy {
  transaction: string;
  fingerprint: string;
  covenantId: string;
}

export interface MembershipTransferSubmission {
  isAccepted: boolean | null;
  transactionId: string | null;
  rejection: string | null;
  acceptedAt: number | null;
}

export interface MembershipDeploySubmission {
  isAccepted: boolean | null;
  transactionId: string | null;
  rejection: string | null;
}

export interface CovenantGateway {
  prepareDeploy(
    covenant: MembershipCovenant,
    deployer: string,
    payoutPk: string,
  ): Promise<PreparedMembershipDeploy>;
  mint(
    offer: MembershipOffer,
    buyer: string,
  ): Promise<PreparedMembershipTransfer>;
  transfer(
    membership: Membership,
    buyer: string,
    saleAmountSompi: string,
  ): Promise<PreparedMembershipTransfer>;
  submitDeploy(
    prepared: PreparedMembershipDeploy,
    signedTransaction: string,
  ): Promise<MembershipDeploySubmission>;
  submit(
    prepared: PreparedMembershipTransfer,
    signedTransaction: string,
  ): Promise<MembershipTransferSubmission>;
  submitMint(
    prepared: PreparedMembershipTransfer,
    signedTransaction: string,
  ): Promise<MembershipTransferSubmission>;
  status(transactionId: string): Promise<MembershipTransferSubmission>;
}

export type MembershipCheckStatus =
  "VALID" | "EXPIRED" | "OWNER_MISMATCH" | "NOT_MEMBERSHIP";

export interface MembershipCheck {
  transactionId: string;
  outputIndex: number;
  covenantId: string | null;
  kind: "token" | "deploy" | "none";
  tokenType: "MINT" | "TRANSFER" | null;
  owner: string | null;
  createdAt: string | null;
  validUntil: string | null;
  status: MembershipCheckStatus;
}

export interface MembershipVerifier {
  verifyAddress(
    address: string,
    expectedOwner?: string,
  ): Promise<MembershipCheck[]>;
  verifyUtxo(
    transactionId: string,
    outputIndex: number,
    expectedOwner?: string,
  ): Promise<MembershipCheck>;
}

export type MembershipTransferAttemptUpdate = Partial<
  Pick<
    MembershipTransferAttempt,
    | "signedTransactionId"
    | "state"
    | "rejection"
    | "submittedAt"
    | "lastCheckedAt"
    | "reconciliationAttempts"
    | "updatedAt"
  >
>;

export type MembershipMintAttemptState =
  "PREPARED" | "PENDING" | "CONFIRMED" | "REJECTED";

export interface MembershipMintAttempt {
  id: string;
  offerId: string;
  buyer: string;
  creator: string;
  covenantId: string;
  priceSompi: string;
  preparedTransaction: string;
  fingerprint: string;
  signedTransactionId: string | null;
  state: MembershipMintAttemptState;
  rejection: string | null;
  submittedAt: number | null;
  lastCheckedAt: number | null;
  reconciliationAttempts: number;
  createdAt: number;
  updatedAt: number;
}

export type MembershipMintAttemptUpdate = Partial<
  Pick<
    MembershipMintAttempt,
    | "signedTransactionId"
    | "state"
    | "rejection"
    | "submittedAt"
    | "lastCheckedAt"
    | "reconciliationAttempts"
    | "updatedAt"
  >
>;
