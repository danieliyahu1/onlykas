import type { MediaType } from "@onlykas/shared";

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
  isPublic: boolean;
  updatedAt: number;
}

export interface Post {
  id: string;
  creator: string;
  caption: string;
  priceSompi: string;
  mediaType: MediaType;
  mediaSize: number;
  mediaDigest: string;
  mediaKey: string;
  publishedAt: number;
}

export interface Purchase {
  postId: string;
  buyer: string;
  transactionId: string;
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

export interface CreatorCovenant {
  creator: string;
  covenantId: string;
}

export interface MembershipPurchase {
  transactionId: string;
  buyer: string;
}

export interface PreparedMembershipTransaction {
  transaction: string;
  fingerprint: string;
  covenantId: string;
  signInputs: number[];
  memberOutputIndex: number | null;
}

export interface PreparedPaymentRecord {
  id: string;
  transaction: string;
  fingerprint: string;
  amountSompi: string;
  creator: string;
  postId: string;
  buyer: string;
  expiresAt: number;
}

export interface PreparedMembershipRecord {
  id: string;
  transaction: string;
  fingerprint: string;
  covenantId: string;
  signInputs: number[];
  memberOutputIndex: number | null;
  creator: string;
  buyer: string;
  kind: "offer" | "purchase";
  expiresAt: number;
}

export type MembershipCheckStatus =
  "VALID" | "EXPIRED" | "OWNER_MISMATCH" | "NOT_MEMBERSHIP";

export interface MembershipCheck {
  transactionId: string;
  outputIndex: number;
  covenantId: string | null;
  kind: "token" | "none";
  tokenType: "membership" | null;
  owner: string | null;
  contentCreator: string | null;
  platformAddress: string | null;
  createdAtDaa: string | null;
  expiresAtDaa: string | null;
  createdAt: string | null;
  validUntil: string | null;
  status: MembershipCheckStatus;
}
