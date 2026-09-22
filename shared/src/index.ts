export const NETWORK = "kaspa_testnet_10" as const;
export const MAX_IMAGE_BYTES = 25_000_000;
export const MAX_VIDEO_BYTES = 100_000_000;
export const KASPA_TESTNET_ADDRESS_PATTERN = /^kaspatest:[a-z0-9]{40,80}$/;

export const MEDIA_COPY = {
  unsupportedMedia: "Choose a JPEG, PNG, WebP, MP4, or WebM file.",
  imageTooLarge: "Images can be up to 25 MB.",
  videoTooLarge: "Videos can be up to 100 MB.",
  invalidPrice: "Enter a KAS price of zero or more, using up to 8 decimal places.",
} as const;

export const FEEDBACK_MAX_MESSAGE = 1500;
export const MIN_MEMBERSHIP_PRICE_SOMPI = 100_000_000n;
export const MAX_MEMBERSHIP_PRICE_SOMPI = 100_000_000_000_000n;
export const MEMBERSHIP_DURATION_DAA = 25_920_000n;

/**
 * A generic, client-agnostic hint attached to a failed response. It tells any
 * caller what the state of the resource allows, without naming a domain code.
 * `AFTER_REFRESH` means the resource changed underneath the request: refetch
 * it, then the caller may submit again.
 */
export const RETRY_AFTER_REFRESH = "AFTER_REFRESH" as const;
export type ApiRetry = typeof RETRY_AFTER_REFRESH;

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
  membership: {
    offered: boolean;
    canceled?: boolean;
    active: boolean;
    priceSompi?: string | null;
    durationDays?: number | null;
    version?: number | null;
  };
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

export type MembershipPriceProblem = "EMPTY" | "FORMAT" | "BELOW_MIN" | "ABOVE_MAX";

/**
 * The single grammar for a monthly price. Returns null when the value is
 * acceptable, or the reason it is not, so the caller can explain the failure.
 */
export function membershipPriceProblem(value: string): MembershipPriceProblem | null {
  const match = /^(\d+)(?:\.(\d{1,8}))?$/.exec(value.trim());
  if (!match || !match[1]) return value.trim() ? "FORMAT" : "EMPTY";
  const sompi =
    BigInt(match[1]) * 100_000_000n + BigInt((match[2] ?? "").padEnd(8, "0"));
  if (sompi < MIN_MEMBERSHIP_PRICE_SOMPI) return "BELOW_MIN";
  if (sompi > MAX_MEMBERSHIP_PRICE_SOMPI) return "ABOVE_MAX";
  return null;
}

export function parseMembershipPrice(value: string): bigint | null {
  if (membershipPriceProblem(value) !== null) return null;
  return parseKasToSompi(value);
}

export function membershipFeeSompi(priceSompi: bigint): bigint {
  const fee = (priceSompi + 50n) / 100n;
  return fee >= 100_000_000n ? fee : 0n;
}

export function parsePostPrice(value: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,8}))?$/.exec(value.trim());
  if (!match || !match[1]) return null;
  return BigInt(match[1]) * 100_000_000n + BigInt((match[2] ?? "").padEnd(8, "0"));
}

export function isFreePost(priceSompi: string): boolean {
  return priceSompi === "0";
}

export function isVideoMedia(mediaType: MediaType): boolean {
  return mediaType.startsWith("video/");
}

export function validatePost(caption: string, price: string): string[] {
  const errors: string[] = [];
  const normalizedCaption = normalizePostText(caption);
  if (
    Array.from(normalizedCaption).length < 1 ||
    Array.from(normalizedCaption).length > 280
  )
    errors.push("Caption must be between 1 and 280 characters.");
  if (parsePostPrice(price) === null) errors.push(MEDIA_COPY.invalidPrice);
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
