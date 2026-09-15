export const NETWORK = "kaspa_testnet_10" as const;
export const MAX_IMAGE_BYTES = 25_000_000;
export const MAX_VIDEO_BYTES = 100_000_000;
export const KASPA_TESTNET_ADDRESS_PATTERN = /^kaspatest:[a-z0-9]{40,80}$/;

export const MEDIA_COPY = {
  unsupportedMedia: "Choose a JPEG, PNG, WebP, MP4, or WebM file.",
  imageTooLarge: "Images can be up to 25 MB.",
  videoTooLarge: "Videos can be up to 100 MB.",
  invalidPrice: "Enter a KAS price greater than zero, using up to 8 decimal places.",
} as const;

export const FEEDBACK_MAX_MESSAGE = 1500;

export const MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/webm",
] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];
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
  isPublic: boolean;
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
  isPublic: boolean;
}

export interface MembershipCheckResponse {
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
  status: "VALID" | "EXPIRED" | "OWNER_MISMATCH" | "NOT_MEMBERSHIP";
}

export interface MembershipAddressVerificationResponse {
  address: string;
  verifiedAt: string;
  valid: boolean;
  memberships: MembershipCheckResponse[];
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
  if (parseKasToSompi(price) === null) errors.push(MEDIA_COPY.invalidPrice);
  return errors;
}

export function mediaHintError(type: string, size: number): string | null {
  if (!MEDIA_TYPES.includes(type as MediaType)) return MEDIA_COPY.unsupportedMedia;
  if (type.startsWith("image/") && size > MAX_IMAGE_BYTES)
    return MEDIA_COPY.imageTooLarge;
  if (type.startsWith("video/") && size > MAX_VIDEO_BYTES)
    return MEDIA_COPY.videoTooLarge;
  return null;
}
