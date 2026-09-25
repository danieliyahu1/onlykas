import type { CreatorResponse, PostResponse } from "@kaskama/shared";
import { Toast, useToast } from "./Toast.js";

/** Renders the shared toast slot the app shell owns, for page-level tests. */
export function ToastSlot() {
  const { toast, dismissToast } = useToast();
  return <Toast toast={toast} onDismiss={dismissToast} />;
}

export const creatorAddress =
  "kaspatest:qrzjdw58hp75mvvx6aq58kjyg3xjk7pt0k8txpll9sxdary9npn8v3pmkukdl";
export const consumerAddress =
  "kaspatest:qzvp9r3gxg4wvcl44lm5phav2gz5zfx2de7qqqwd3hjlr53rtsn6wefhk0aj8";

export function creator(
  isOwner: boolean,
  offered: boolean,
  active = false,
): CreatorResponse {
  return {
    address: creatorAddress,
    displayAddress: creatorAddress,
    displayName: "Creator",
    isPublic: false,
    isOwner,
    membership: { offered, active },
    posts: [],
  };
}

export function unnamedCreator(): CreatorResponse {
  return { ...creator(false, false), displayName: null };
}

export function post(id: string, caption: string, canView: boolean): PostResponse {
  return {
    id,
    creator: creatorAddress,
    caption,
    priceSompi: "100000000",
    mediaType: "image/jpeg",
    publishedAt: "2026-09-10T00:00:00.000Z",
    canView,
  };
}
