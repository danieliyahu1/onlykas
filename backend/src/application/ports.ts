import type {
  Challenge,
  CreatorCovenant,
  MembershipCheck,
  MembershipPurchase,
  MembershipCheckStatus,
  Post,
  PreparedMembershipRecord,
  PreparedMembershipTransaction,
  PreparedPaymentRecord,
  PreparedPayment,
  PaymentSubmission,
  Profile,
  Purchase,
  Session,
} from "../domain/models.js";

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

export interface Store {
  initialize(): Promise<void>;
  createChallenge(value: Challenge): Promise<void>;
  consumeChallenge(id: string, now: number): Promise<Challenge | null>;
  pruneChallenges(now: number): Promise<void>;
  savePreparedPayment(value: PreparedPaymentRecord): Promise<void>;
  getPreparedPayment(id: string, now: number): Promise<PreparedPaymentRecord | null>;
  deletePreparedPayment(id: string): Promise<void>;
  prunePreparedPayments(now: number): Promise<void>;
  savePreparedMembership(value: PreparedMembershipRecord): Promise<void>;
  getPreparedMembership(
    id: string,
    now: number,
  ): Promise<PreparedMembershipRecord | null>;
  deletePreparedMembership(id: string): Promise<void>;
  prunePreparedMemberships(now: number): Promise<void>;
  createSession(value: Session): Promise<void>;
  getSession(id: string, now: number): Promise<Session | null>;
  rollSession(id: string, expiresAt: number): Promise<void>;
  deleteSession(id: string): Promise<void>;
  pruneSessions(now: number): Promise<void>;
  getProfile(address: string): Promise<Profile | null>;
  saveProfile(value: Profile): Promise<void>;
  searchCreators(name: string, limit: number): Promise<Profile[]>;
  publicCreators(limit: number): Promise<Profile[]>;
  publishPost(value: Post): Promise<"COMMITTED" | "MEDIA_DIGEST_CONFLICT">;
  getPost(id: string): Promise<Post | null>;
  creatorPosts(address: string): Promise<Post[]>;
  createPurchase(value: Purchase): Promise<boolean>;
  getPurchase(postId: string, buyer: string): Promise<Purchase | null>;
  purchasesForBuyer(buyer: string): Promise<Purchase[]>;
  getCreatorCovenant(creator: string): Promise<CreatorCovenant | null>;
  saveCreatorCovenant(value: CreatorCovenant): Promise<void>;
  createMembershipPurchase(value: MembershipPurchase): Promise<boolean>;
  membershipPurchases(buyer: string): Promise<MembershipPurchase[]>;
}

export interface ObjectStorage {
  putFile(key: string, sourcePath: string, contentType: string): Promise<void>;
  readRange(
    key: string,
    start?: number,
    end?: number,
  ): Promise<{ bytes: Uint8Array; size: number; contentType: string }>;
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

export type { MembershipCheckStatus };
export type { PaymentSubmission, PreparedMembershipTransaction };
