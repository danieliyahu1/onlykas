export const NETWORK = "kaspa_testnet_10" as const;
export const CHALLENGE_TTL_MS = 5 * 60 * 1_000;
export const SESSION_IDLE_TTL_MS = 15 * 60 * 1_000;
export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1_000;
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
  description: string;
  priceSompi: string;
  mediaType: MediaType;
  publishedAt: string;
  canView: boolean;
}

export interface CreatorResponse {
  address: string;
  displayAddress: string;
  posts: PostResponse[];
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
  description: string,
  price: string,
): string[] {
  const errors: string[] = [];
  const normalizedTitle = normalizePostText(title);
  const normalizedDescription = normalizePostText(description);
  if (
    Array.from(normalizedTitle).length < 1 ||
    Array.from(normalizedTitle).length > 80
  )
    errors.push("Title must be between 1 and 80 characters.");
  if (
    Array.from(normalizedDescription).length < 1 ||
    Array.from(normalizedDescription).length > 280
  )
    errors.push("Description must be between 1 and 280 characters.");
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
