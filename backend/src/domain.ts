import type { MediaType } from "@onlykas/shared";

export interface Challenge { id: string; nonce: string; address: string; origin: string; network: string; message: string; expiresAt: number; consumedAt: number | null; }
export interface Session { id: string; address: string; expiresAt: number; }
export interface Profile { address: string; displayName: string | null; updatedAt: number; }
export interface Post { id: string; creator: string; caption: string; priceSompi: string; mediaType: MediaType; mediaSize: number; mediaDigest: string; mediaKey: string; publishedAt: number; }
export interface Purchase { postId: string; buyer: string; transactionId: string; }
export interface PreparedPayment { transaction: string; fingerprint: string; amountSompi: string; creator: string; }
export interface PaymentSubmission { isAccepted: boolean | null; transactionId: string | null; rejection: string | null; }
export interface PaymentGateway {
  prepare(post: Post, buyer: string): Promise<PreparedPayment>;
  submit(prepared: PreparedPayment, signedTransaction: string): Promise<PaymentSubmission>;
  status(transactionId: string): Promise<PaymentSubmission>;
  verifyPurchase(transactionId: string, buyer: string, creator: string, amountSompi: string): Promise<boolean>;
}
export interface CreatorCovenant { creator: string; covenantId: string; }
export interface MembershipPurchase { transactionId: string; buyer: string; }
export interface PreparedMembershipTransaction { transaction: string; fingerprint: string; covenantId: string; signInputs: number[]; memberOutputIndex: number | null; }
export interface MembershipGateway {
  prepareOffer(creator: string): Promise<PreparedMembershipTransaction>;
  prepareMint(creator: string, buyer: string, covenantId: string): Promise<PreparedMembershipTransaction>;
  submit(prepared: PreparedMembershipTransaction, signedTransaction: string): Promise<PaymentSubmission>;
}

export interface Store {
  initialize(): Promise<void>;
  createChallenge(value: Challenge): Promise<void>;
  consumeChallenge(id: string, now: number): Promise<Challenge | null>;
  pruneChallenges(now: number): Promise<void>;
  createSession(value: Session): Promise<void>;
  getSession(id: string, now: number): Promise<Session | null>;
  rollSession(id: string, expiresAt: number): Promise<void>;
  deleteSession(id: string): Promise<void>;
  getProfile(address: string): Promise<Profile | null>;
  saveProfile(value: Profile): Promise<void>;
  searchCreators(name: string, limit: number): Promise<Profile[]>;
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
  readRange(key: string, start?: number, end?: number): Promise<{ bytes: Uint8Array; size: number; contentType: string }>;
  delete(key: string): Promise<void>;
}
export interface WalletVerifier { verify(message: string, signature: string, publicKey: string, address: string): Promise<boolean>; }
export type MembershipCheckStatus = "VALID" | "EXPIRED" | "OWNER_MISMATCH" | "NOT_MEMBERSHIP";
export interface MembershipCheck { transactionId: string; outputIndex: number; covenantId: string | null; kind: "token" | "none"; tokenType: "MINT" | null; owner: string | null; createdAt: string | null; validUntil: string | null; status: MembershipCheckStatus; }
export interface MembershipVerifier {
  verifyAddress(address: string, expectedOwner?: string, expectedCovenantId?: string, expectedCreator?: string): Promise<MembershipCheck[]>;
  verifyUtxo(transactionId: string, outputIndex: number, expectedOwner?: string, expectedCovenantId?: string, expectedCreator?: string): Promise<MembershipCheck>;
}
