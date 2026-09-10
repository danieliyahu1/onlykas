export const NETWORK = "kaspa_testnet_10" as const;
export const CHALLENGE_TTL_MS = 2 * 60 * 1_000;
export const SESSION_IDLE_TTL_MS = 15 * 60 * 1_000;
export const PAYMENT_RECEIPT_TTL_MS = 15 * 60 * 1_000;
export const PREPARED_TTL_MS = 5 * 60 * 1_000;
export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1_000;
export const MEMBERSHIP_DESCRIPTION_MAX = 280;
export const MAX_IMAGE_BYTES = 25_000_000;
export const MAX_VIDEO_BYTES = 100_000_000;
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
  serverDown: "Server is down. Try again shortly.",
  unsupportedMedia: "Choose a JPEG, PNG, WebP, MP4, or WebM file.",
  imageTooLarge: "Images can be up to 25 MB.",
  videoTooLarge: "Videos can be up to 100 MB.",
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
  unlocked: "Unlocked.",
  insufficientFunds: "You need enough KAS for the post and the network fee.",
  transactionRejected:
    "Transaction rejected. No access was granted. Try again.",
  purchasePending: "Purchase pending. Do not pay again.",
  paymentTimedOut: "We couldn't confirm the payment. Check the transaction and try again.",
  accessVerificationFailed: "OnlyKas can't verify access right now. Try again.",
  unlockRequired: "Unlock this post to view it.",
  invalidCreatorAddress: "Enter a complete Kaspa testnet address.",
  offerInvalid: "Add a price and a warm note for your circle.",
  offerSignPrompt: "Sign in Kasware to open your circle.",
  offerSigning: "Waiting on your wallet...",
  offeringDeploy: "Getting it ready...",
  offerDeployPending: "Opening your circle...",
  offerLive: "Your circle is open.",
  offerPublishFailed: "We couldn't open your circle just now. Try again.",
  membershipAlreadyExists:
    "You already have a circle open. We'll still sign you through — just a moment.",
  offerMembershipTitle: "Your inner circle",
  offerMembershipIntro:
    "A private day of access for the people who support you most.",
  offerDescriptionLabel: "What they get",
  offerDescriptionHint: "Welcome them warmly — say what the day holds.",
  offerMembershipPermanence:
    "Once it's open, your price and your words stay as they are. Choose well.",
  membershipUnavailable: "Membership is catching up. Try again in a moment.",
  becomeMemberFor: "Become a member for {price}",
  renewMembershipFor: "Renew for {price}",
  membershipPrompt:
    "This sends {price} KAS and opens one day of access. The network fee shows in Kasware before you approve. It can't be undone.",
  membershipSigning: "Approve in Kasware",
  membershipConfirming: "Making it official...",
  membershipPending: "On its way — nothing more to do.",
  membershipLive: "You're a member.",
  membershipExpired: "Your time as a member has passed.",
  membershipRejected:
    "Nothing went through, and nothing was charged. Whenever you're ready, try again.",
  membershipNoOffer: "This creator hasn't opened their circle yet.",
  membershipActiveUntil: "Active until {date}.",
  membershipExpiredOn: "It ended {date}.",
  membershipPriceMismatch:
    "The price changed while you were joining. Take a fresh look and try again.",
  membershipNoteOpen: "The door is open. One day at a time.",
  membershipNoteMember: "Renew any time. Pass it on when you're ready.",
  membershipNoteLapsed: "The door is still open.",
  transferTitle: "Pass it on",
  transferIntro:
    "A friend can take over your remaining day. You set the price — the creator keeps 10%, the rest is yours.",
  transferRecipientLabel: "Who gets it",
  transferRecipientHint: "Their Kaspa address",
  transferSaleLabel: "Your price",
  transferSignPrompt:
    "Sign in Kasware to pass it on. The creator keeps 10% and {seller} KAS comes to you. It can't be undone.",
  transferSigning: "Approve in Kasware",
  transferConfirming: "Passing it on...",
  transferPending: "On its way — nothing more to do.",
  transferSent: "Done. Your pass has a new home.",
  transferRejected:
    "Nothing went through, and nothing was charged. Whenever you're ready, try again.",
  transferInvalidRecipient: "Enter a complete Kaspa address.",
  transferInvalidAmount: "Set a price above zero.",
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
  isOwner: boolean;
  membership: { offered: boolean; active: boolean };
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

export type MembershipCheckStatus =
  "VALID" | "EXPIRED" | "OWNER_MISMATCH" | "NOT_MEMBERSHIP";

export interface MembershipCheckResponse {
  transactionId: string;
  outputIndex: number;
  covenantId: string | null;
  kind: "token" | "none";
  tokenType: "MINT" | null;
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

export function validatePost(caption: string, price: string): string[] {
  const errors: string[] = [];
  const normalizedCaption = normalizePostText(caption);
  if (
    Array.from(normalizedCaption).length < 1 ||
    Array.from(normalizedCaption).length > 280
  )
    errors.push("Caption must be between 1 and 280 characters.");
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
