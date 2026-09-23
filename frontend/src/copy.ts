export const COPY = {
  authPrompt:
    "Connect to OnlyKas. This only identifies your wallet. No KAS will be sent.",
  kaswareMissing:
    "Open Kasware to connect. Your wallet is used to identify you and approve payments.",
  wrongNetwork: "Your wallet is on the wrong network. Switch networks and try again.",
  networkSwitched: "You're on {network} now.",
  walletCancelled: "Wallet connection cancelled.",
  signInCancelled: "Sign-in cancelled.",
  verificationFailed: "OnlyKas could not verify this wallet. Try again.",
  serverDown: "Server is down. Try again shortly.",
  unsupportedMedia: "Choose a JPEG, PNG, WebP, MP4, or WebM file.",
  imageTooLarge: "Images can be up to 25 MB.",
  videoTooLarge: "Videos can be up to 100 MB.",
  malformedMedia: "This file cannot be played by OnlyKas.",
  uploadFailed: "Upload failed. Try again.",
  invalidPrice: "Enter a KAS price of zero or more, using up to 8 decimal places.",
  permanence:
    "Publishing is permanent. The media, details, and price cannot be changed.",
  publishingCancelled: "Publishing cancelled.",
  publishing: "Publishing...",
  published: "Published.",
  publishFailed: "Post was not published. Try again.",
  mediaAlreadyPublished: "You've already published this.",
  mediaUnavailable:
    "This media is temporarily unavailable. Your purchase is unchanged.",
  unlockPrompt:
    "You are supporting this creator with {price} KAS. Kasware will show the network fee before you approve. This payment cannot be reversed.",
  paymentCancelled: "Payment cancelled.",
  unlocked: "Unlocked.",
  membershipAccess: "Creator-priced access · 30 days",
  insufficientFunds: "You need enough KAS for the post and the network fee.",
  transactionRejected: "Transaction rejected. Nothing was charged. Try again.",
  purchasePending: "Purchase pending. Do not pay again.",
  paymentTimedOut:
    "We couldn't confirm the payment. Check the transaction and try again.",
  accessVerificationFailed:
    "OnlyKas can't verify your subscription right now. Try again.",
  unlockRequired: "Unlock this post to view it.",
  feedbackButton: "How can we improve",
  feedbackDialogTitle: "Send feedback",
  feedbackLabel: "What should we improve?",
  feedbackHint: "Anonymous",
  feedbackPlaceholder: "Tell us your experience",
  feedbackSend: "Send",
  feedbackThanks: "Thanks — sent.",
  feedbackRequired: "Write a few words first.",
  feedbackFailed: "Couldn’t send feedback. Try again.",
} as const;
