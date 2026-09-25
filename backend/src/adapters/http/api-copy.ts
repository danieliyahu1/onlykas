import type { MembershipPriceProblem } from "@kaskama/shared";

export const API_COPY = {
  authPrompt:
    "Connect to Kaskama. This only identifies your wallet. No KAS will be sent.",
  verificationFailed: "Kaskama could not verify this wallet. Try again.",
  invalidPrice: "Enter a KAS price greater than zero, using up to 8 decimal places.",
  membershipPriceEmpty: "Enter a monthly subscription price.",
  membershipPriceFormat: "Enter the price in digits only, with up to 8 decimal places.",
  membershipPriceBelowMin: "The monthly subscription price must be at least 1 KAS.",
  membershipPriceAboveMax:
    "The monthly subscription price can be at most 1,000,000 KAS.",
  membershipStale:
    "This subscription changed while you were confirming it. Nothing was charged — submit again.",
  membershipOfferExists: "This subscription is already live.",
  membershipCancellationStale: "This subscription already changed. Submit again.",
  membershipPurchaseExists: "You already have this subscription.",
  insufficientFunds: "You need enough KAS for the post and the network fee.",
  purchasePending: "Purchase pending. Do not pay again.",
  transactionRejected: "Transaction rejected. Nothing was charged. Try again.",
  unlocked: "Unlocked.",
  unsupportedMedia: "Choose a JPEG, PNG, WebP, MP4, or WebM file.",
  imageTooLarge: "Images can be up to 25 MB.",
  videoTooLarge: "Videos can be up to 100 MB.",
  mediaAlreadyPublished: "You've already published this.",
} as const;

export function membershipPriceMessage(problem: MembershipPriceProblem): string {
  switch (problem) {
    case "EMPTY":
      return API_COPY.membershipPriceEmpty;
    case "FORMAT":
      return API_COPY.membershipPriceFormat;
    case "BELOW_MIN":
      return API_COPY.membershipPriceBelowMin;
    case "ABOVE_MAX":
      return API_COPY.membershipPriceAboveMax;
  }
}
