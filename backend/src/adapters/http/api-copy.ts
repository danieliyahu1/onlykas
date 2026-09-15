export const API_COPY = {
  authPrompt:
    "Connect to OnlyKas. This only identifies your wallet. No KAS will be sent.",
  verificationFailed: "OnlyKas could not verify this wallet. Try again.",
  invalidPrice: "Enter a KAS price greater than zero, using up to 8 decimal places.",
  insufficientFunds: "You need enough KAS for the post and the network fee.",
  purchasePending: "Purchase pending. Do not pay again.",
  transactionRejected: "Transaction rejected. Nothing was charged. Try again.",
  unlocked: "Unlocked.",
  unsupportedMedia: "Choose a JPEG, PNG, WebP, MP4, or WebM file.",
  imageTooLarge: "Images can be up to 25 MB.",
  videoTooLarge: "Videos can be up to 100 MB.",
} as const;
