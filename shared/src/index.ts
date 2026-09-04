export const NETWORK = "kaspa_testnet_10" as const;
export const CHALLENGE_TTL_MS = 5 * 60 * 1_000;
export const SESSION_IDLE_TTL_MS = 15 * 60 * 1_000;
export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1_000;
export const MEMBERSHIP_DESCRIPTION_MAX = 280;
export const MAX_IMAGE_BYTES = 25_000_000;
export const MAX_VIDEO_BYTES = 500_000_000;
export const MIN_MULTIPART_PART_BYTES = 5 * 1024 * 1024;
export const KASPA_TESTNET_ADDRESS_PATTERN = /^kaspatest:[a-z0-9]{40,80}$/;

export const COPY = {
  authPrompt:
    "Connect to OnlyKas. This only identifies your wallet. No KAS will be sent.",
  kaswareMissing:
    "Open Kasware to connect. Your wallet is used to identify you and approve payments.",
  wrongNetwork:
    "Your wallet is on the wrong network. Switch networks in Kasware and try again.",
  walletCancelled: "Wallet connection cancelled.",
  signInCancelled: "Sign-in cancelled.",
  verificationFailed: "OnlyKas could not verify this wallet. Try again.",
  unsupportedMedia: "Choose a JPEG, PNG, WebP, MP4, or WebM file.",
  imageTooLarge: "Images can be up to 25 MB.",
  videoTooLarge: "Videos can be up to 500 MB.",
  malformedMedia: "This file cannot be played by OnlyKas.",
  uploadFailed: "Upload failed. Try again.",
  invalidPrice:
    "Enter a KAS price greater than zero, using up to 8 decimal places.",
  permanence:
    "Publishing is permanent. The media, details, and price cannot be changed.",
  publishingCancelled: "Publishing cancelled.",
  publishing: "Publishing...",
  published: "Published.",
  publishFailed: "Post was not published. Try again.",
  mediaAlreadyPublished:
    "This photo or video has already been published. Choose another.",
  mediaUnavailable:
    "This media is temporarily unavailable. Your purchase is unchanged.",
  unlockPrompt:
    "You are supporting this creator with {price} KAS. Kasware will show the network fee before you approve. This payment cannot be reversed.",
  paymentCancelled: "Payment cancelled.",
  confirmingPayment: "Confirming payment...",
  unlocked: "Unlocked.",
  insufficientFunds: "You need enough KAS for the post and the network fee.",
  transactionRejected:
    "Transaction rejected. No access was granted. Try again.",
  purchasePending: "Purchase pending. Do not pay again.",
  accessVerificationFailed: "OnlyKas can't verify access right now. Try again.",
  unlockRequired: "Unlock this post to view it.",
  invalidCreatorAddress: "Enter a complete Kaspa testnet address.",
  offerInvalid: "Add a price and a description for your membership offer.",
  offerSignPrompt:
    "Sign the deploy transaction in Kasware to publish your offer.",
  offerSigning: "Waiting for your signature...",
  offeringDeploy: "Deploying your membership offer...",
  offerDeployPending:
    "Membership offer is deploying. Your price and description are fixed. Do not submit again.",
  offerLive: "Your membership offer is live.",
  offerPublishFailed: "The membership offer could not be published. Try again.",
  offerMembershipTitle: "Membership",
  offerMembershipIntro: "Offer one day of access for a fixed price.",
  offerDescriptionLabel: "What supporters get",
  offerDescriptionHint: "What supporters get for one day of access.",
  offerMembershipPermanence:
    "Once the offer is live, its price and description cannot be changed.",
  membershipUnavailable:
    "Membership offers are temporarily unavailable. Try again.",
  becomeMemberFor: "Become a member for {price}",
  renewMembershipFor: "Renew for {price}",
  membershipPrompt:
    "Support this creator with {price} KAS and get one day of access. Kasware will show the network fee before you approve. This payment cannot be reversed.",
  membershipSigning: "Waiting for your signature...",
  membershipConfirming: "Confirming your membership...",
  membershipPending: "Membership pending. Do not pay again.",
  membershipLive: "You're a member.",
  membershipExpired: "Your membership has expired.",
  membershipRejected:
    "Transaction rejected. No membership was granted. Try again.",
  membershipNoOffer: "No membership offer from this creator yet.",
  membershipActiveUntil: "Active until {date}.",
  membershipExpiredOn: "Expired {date}.",
  membershipPriceMismatch:
    "The prepared payment does not match the offer price. Try again.",
  transferTitle: "Resell your membership",
  transferIntro:
    "Pass your remaining access to another wallet. The creator keeps 10% of the sale and you keep the rest.",
  transferRecipientLabel: "Recipient",
  transferRecipientHint: "Which wallet gets your remaining access?",
  transferSaleLabel: "Sale price",
  transferSignPrompt:
    "Sign the transfer in Kasware. The creator receives 10% and you receive {seller} KAS. This cannot be reversed.",
  transferSigning: "Waiting for your signature...",
  transferConfirming: "Confirming your transfer...",
  transferPending: "Transfer pending. Do not resubmit.",
  transferSent: "Membership transferred.",
  transferRejected:
    "Transaction rejected. The membership was not transferred. Try again.",
  transferInvalidRecipient: "Enter a complete Kaspa testnet address.",
  transferInvalidAmount: "Enter a sale price greater than zero.",
  transferExpired: "This membership has expired and cannot be resold.",
  transferNotHolder: "Only the current holder can resell this membership.",
  transferUnavailable:
    "Membership transfers are temporarily unavailable. Try again.",
  transferNotFound: "This transfer could not be found.",
} as const;

export const MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/webm",
] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];
export type UploadState =
  | "CREATED"
  | "UPLOADED"
  | "VERIFYING"
  | "VERIFIED"
  | "REJECTED"
  | "PUBLISHED"
  | "EXPIRED";
export type UploadError =
  | "UNSUPPORTED_MEDIA"
  | "IMAGE_TOO_LARGE"
  | "VIDEO_TOO_LARGE"
  | "MALFORMED_MEDIA"
  | "STORAGE_FAILURE"
  | null;

export interface ChallengeResponse {
  challengeId: string;
  message: string;
  expiresAt: string;
}

export interface SessionResponse {
  address: string;
  expiresAt: string;
}

export interface UploadResponse {
  id: string;
  state: UploadState;
  expiresAt: string;
  error: UploadError;
  progress?: number;
}

export interface PostResponse {
  id: string;
  creator: string;
  title: string;
  caption: string;
  priceSompi: string;
  mediaType: MediaType;
  publishedAt: string;
  canView: boolean;
}

export interface CreatorResponse {
  address: string;
  displayAddress: string;
  displayName: string | null;
  posts: PostResponse[];
}

export interface CreatorSearchResult {
  address: string;
  displayAddress: string;
  displayName: string | null;
}

export interface ProfileResponse {
  address: string;
  displayAddress: string;
  displayName: string | null;
}

export type MembershipOfferDeployState =
  "PREPARED" | "PENDING" | "CONFIRMED" | "REJECTED";

export interface MembershipOfferResponse {
  id: string;
  creator: string;
  covenantId: string;
  priceSompi: string;
  description: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MembershipDeployResponse {
  id: string;
  creator: string;
  covenantId: string;
  priceSompi: string;
  description: string;
  state: MembershipOfferDeployState;
  transaction?: string;
  fingerprint?: string;
  transactionId: string | null;
  rejection: string | null;
  offer: MembershipOfferResponse | null;
}

export type MembershipState = "ACTIVE" | "EXPIRED" | "TRANSFERRED";

export interface MembershipResponse {
  id: string;
  offerId: string;
  owner: string;
  creator: string;
  covenantId: string;
  createdTxId: string | null;
  createdAt: string;
  validUntil: string;
  state: MembershipState;
}

export type MembershipMintAttemptState =
  "PREPARED" | "PENDING" | "CONFIRMED" | "REJECTED";

export interface MembershipMintAttemptResponse {
  id: string;
  offerId: string;
  creator: string;
  covenantId: string;
  priceSompi: string;
  state: MembershipMintAttemptState;
  transaction?: string;
  fingerprint?: string;
  transactionId: string | null;
  rejection: string | null;
  submittedAt: number | null;
  lastCheckedAt: number | null;
  reconciliationAttempts: number;
  membership: MembershipResponse | null;
}

export type MembershipTransferAttemptState =
  "PREPARED" | "PENDING" | "CONFIRMED" | "REJECTED";

export interface MembershipTransferAttemptResponse {
  id: string;
  membershipId: string;
  seller: string;
  buyer: string;
  saleAmountSompi: string;
  creatorRoyaltySompi: string;
  creatorPayoutAddress: string;
  state: MembershipTransferAttemptState;
  transaction?: string;
  fingerprint?: string;
  transactionId: string | null;
  rejection: string | null;
  submittedAt: number | null;
  lastCheckedAt: number | null;
  reconciliationAttempts: number;
  membership: MembershipResponse | null;
}

export type MembershipCheckStatus =
  "VALID" | "EXPIRED" | "OWNER_MISMATCH" | "NOT_MEMBERSHIP";

export interface MembershipCheckResponse {
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

export interface MembershipAddressVerificationResponse {
  address: string;
  verifiedAt: string;
  valid: boolean;
  memberships: MembershipCheckResponse[];
}

export function createChallengeMessage(
  address: string,
  nonce: string,
  origin: string,
): string {
  return `${COPY.authPrompt}\n\nWallet: ${address}\nNetwork: ${NETWORK}\nOrigin: ${origin}\nNonce: ${nonce}`;
}

export function normalizePostText(value: string): string {
  return value.trim();
}

export function normalizeDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function validateDisplayName(value: string): string | null {
  const name = normalizeDisplayName(value);
  if (Array.from(name).length > 40) return "Names can be up to 40 characters.";
  return name.length === 0 ? null : name;
}

export function isKaspaTestnetAddress(value: string): boolean {
  return KASPA_TESTNET_ADDRESS_PATTERN.test(value);
}

export function parseKasToSompi(value: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,8}))?$/.exec(value.trim());
  if (!match || !match[1]) return null;
  const sompi =
    BigInt(match[1]) * 100_000_000n + BigInt((match[2] ?? "").padEnd(8, "0"));
  return sompi > 0n ? sompi : null;
}

export function validatePost(
  title: string,
  caption: string,
  price: string,
): string[] {
  const errors: string[] = [];
  const normalizedTitle = normalizePostText(title);
  const normalizedCaption = normalizePostText(caption);
  if (
    Array.from(normalizedTitle).length < 1 ||
    Array.from(normalizedTitle).length > 80
  )
    errors.push("Title must be between 1 and 80 characters.");
  if (
    Array.from(normalizedCaption).length < 1 ||
    Array.from(normalizedCaption).length > 280
  )
    errors.push("Captions must be between 1 and 280 characters.");
  if (parseKasToSompi(price) === null) errors.push(COPY.invalidPrice);
  return errors;
}

export function validateMembershipOffer(
  price: string,
  description: string,
): string[] {
  const errors: string[] = [];
  const normalizedDescription = normalizePostText(description);
  if (
    Array.from(normalizedDescription).length < 1 ||
    Array.from(normalizedDescription).length > MEMBERSHIP_DESCRIPTION_MAX
  )
    errors.push(
      `Descriptions must be up to ${MEMBERSHIP_DESCRIPTION_MAX} characters.`,
    );
  if (parseKasToSompi(price) === null) errors.push(COPY.invalidPrice);
  return errors;
}

export function mediaHintError(type: string, size: number): string | null {
  if (!MEDIA_TYPES.includes(type as MediaType)) return COPY.unsupportedMedia;
  if (type.startsWith("image/") && size > MAX_IMAGE_BYTES)
    return COPY.imageTooLarge;
  if (type.startsWith("video/") && size > MAX_VIDEO_BYTES)
    return COPY.videoTooLarge;
  return null;
}
