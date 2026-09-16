import type {
  Challenge,
  CreatorCovenant,
  MembershipCheck,
  MembershipPurchase,
  Post,
  PreparedMembershipRecord,
  PreparedMembershipTransaction,
  MembershipWorkflow,
  PreparedPaymentRecord,
  PreparedPayment,
  PaymentSubmission,
  PaymentWorkflow,
  Profile,
  Purchase,
  Session,
} from "../domain/models.js";

export type DuplicateOutcome = "CREATED" | "DUPLICATE";

export interface ChallengeRepository {
  createChallenge(value: Challenge): Promise<void>;
  consumeChallenge(id: string, now: number): Promise<Challenge | null>;
  pruneChallenges(now: number): Promise<void>;
}

export interface SessionRepository {
  createSession(value: Session): Promise<void>;
  getSession(id: string, now: number): Promise<Session | null>;
  rollSession(id: string, expiresAt: number): Promise<void>;
  deleteSession(id: string): Promise<void>;
  pruneSessions(now: number): Promise<void>;
}

export interface PreparedPaymentRepository {
  savePreparedPayment(value: PreparedPaymentRecord): Promise<void>;
  getPreparedPayment(id: string, now: number): Promise<PreparedPaymentRecord | null>;
  deletePreparedPayment(id: string): Promise<void>;
  prunePreparedPayments(now: number): Promise<void>;
  savePaymentWorkflow(value: PaymentWorkflow): Promise<void>;
  getPaymentWorkflow(preparedPaymentId: string): Promise<PaymentWorkflow | null>;
  deletePaymentWorkflow(preparedPaymentId: string): Promise<void>;
}

export interface PreparedMembershipRepository {
  savePreparedMembership(value: PreparedMembershipRecord): Promise<void>;
  getPreparedMembership(
    id: string,
    now: number,
  ): Promise<PreparedMembershipRecord | null>;
  deletePreparedMembership(id: string): Promise<void>;
  prunePreparedMemberships(now: number): Promise<void>;
  saveMembershipWorkflow(value: MembershipWorkflow): Promise<void>;
  getMembershipWorkflow(
    preparedMembershipId: string,
  ): Promise<MembershipWorkflow | null>;
  deleteMembershipWorkflow(preparedMembershipId: string): Promise<void>;
}

export interface ProfileRepository {
  getProfile(address: string): Promise<Profile | null>;
  saveProfile(value: Profile): Promise<void>;
  searchCreators(name: string, limit: number): Promise<Profile[]>;
  publicCreators(limit: number): Promise<Profile[]>;
}

export interface PostRepository {
  reservePublication(value: Post, expiresAt: number): Promise<"RESERVED" | "DUPLICATE">;
  commitPublication(value: Post): Promise<"COMMITTED" | "DUPLICATE">;
  releasePublication(postId: string): Promise<void>;
  prunePendingPublications(now: number): Promise<void>;
  publishPost(value: Post): Promise<"COMMITTED" | "MEDIA_DIGEST_CONFLICT">;
  getPost(id: string): Promise<Post | null>;
  findPostByMedia(creator: string, digest: string): Promise<Post | null>;
  creatorPosts(address: string): Promise<Post[]>;
}

export interface PurchaseRepository {
  createPurchase(value: Purchase): Promise<DuplicateOutcome>;
  getPurchase(postId: string, buyer: string): Promise<Purchase | null>;
  purchasesForBuyer(buyer: string): Promise<Purchase[]>;
  finalizePurchase(
    preparedPaymentId: string,
    value: Purchase,
  ): Promise<DuplicateOutcome>;
}

export interface CovenantRepository {
  getCreatorCovenant(creator: string): Promise<CreatorCovenant | null>;
  saveCreatorCovenant(value: CreatorCovenant): Promise<DuplicateOutcome>;
  finalizeOffer(
    preparedMembershipId: string,
    value: CreatorCovenant,
  ): Promise<DuplicateOutcome>;
}

export interface MembershipPurchaseRepository {
  createMembershipPurchase(value: MembershipPurchase): Promise<DuplicateOutcome>;
  membershipPurchases(buyer: string): Promise<MembershipPurchase[]>;
  finalizeMembershipPurchase(
    preparedMembershipId: string,
    value: MembershipPurchase,
  ): Promise<DuplicateOutcome>;
}

export interface Repositories
  extends
    ChallengeRepository,
    SessionRepository,
    PreparedPaymentRepository,
    PreparedMembershipRepository,
    ProfileRepository,
    PostRepository,
    PurchaseRepository,
    CovenantRepository,
    MembershipPurchaseRepository {
  initialize(): Promise<void>;
}

export interface PaymentGateway {
  prepare(post: Post, buyer: string): Promise<PreparedPayment>;
  submit(
    prepared: PreparedPayment,
    signedTransaction: string,
  ): Promise<PaymentSubmission>;
  status(transactionId: string): Promise<PaymentSubmission>;
  verifyPurchase(
    transactionId: string,
    buyer: string,
    creator: string,
    amountSompi: string,
  ): Promise<boolean>;
}

export interface MembershipGateway {
  prepareOffer(creator: string): Promise<PreparedMembershipTransaction>;
  prepareMint(
    creator: string,
    buyer: string,
    covenantId: string,
  ): Promise<PreparedMembershipTransaction>;
  submit(
    prepared: PreparedMembershipTransaction,
    signedTransaction: string,
  ): Promise<PaymentSubmission>;
}

export interface ObjectStorage {
  putFile(key: string, sourcePath: string, contentType: string): Promise<void>;
  readRange(
    key: string,
    start?: number,
    end?: number,
  ): Promise<{ bytes: Uint8Array; size: number; contentType: string }>;
  streamRange?: (
    key: string,
    start?: number,
    end?: number,
  ) => Promise<{
    body: AsyncIterable<Uint8Array>;
    size: number;
    contentType: string;
  }>;
  delete(key: string): Promise<void>;
}

export interface WalletVerifier {
  verify(
    message: string,
    signature: string,
    publicKey: string,
    address: string,
  ): Promise<boolean>;
}

export interface MembershipVerifier {
  verifyAddress(
    address: string,
    expectedOwner?: string,
    expectedCovenantId?: string,
    expectedCreator?: string,
  ): Promise<MembershipCheck[]>;
  verifyUtxo(
    transactionId: string,
    outputIndex: number,
    expectedOwner?: string,
    expectedCovenantId?: string,
    expectedCreator?: string,
  ): Promise<MembershipCheck>;
}

export type { PaymentSubmission, PreparedMembershipTransaction };
