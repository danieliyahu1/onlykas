import { api, signPreparedPayment } from "./kasware.js";

export interface PurchaseResult {
  state: string;
  message?: string;
}

interface PreparedTransaction {
  id: string;
  transaction: string;
}

interface PreparedSubscription extends PreparedTransaction {
  signInputs: number[];
}

export async function unlockPost(
  postId: string,
  onApproved?: () => void,
): Promise<PurchaseResult> {
  const prepared = await api<PreparedTransaction>(
    `/api/posts/${encodeURIComponent(postId)}/payments/prepare`,
    { method: "POST" },
  );
  const signedTransaction = await signPreparedPayment(prepared.transaction);
  onApproved?.();
  return api<PurchaseResult>(`/api/payments/${prepared.id}/finalize`, {
    method: "POST",
    body: JSON.stringify({ signedTransaction }),
  });
}

export async function prepareSubscription(
  actingAsOwner: boolean,
  creatorAddress: string,
  priceSompi?: string,
): Promise<PreparedSubscription> {
  const path = actingAsOwner
    ? "/api/membership/offers/prepare"
    : `/api/membership/${encodeURIComponent(creatorAddress)}/prepare`;
  return api<PreparedSubscription>(path, {
    method: "POST",
    ...(actingAsOwner && priceSompi
      ? { body: JSON.stringify({ price: priceSompi }) }
      : {}),
  });
}

export async function finalizeSubscription(
  actingAsOwner: boolean,
  preparedId: string,
  signedTransaction: string,
): Promise<PurchaseResult> {
  const path = actingAsOwner
    ? `/api/membership/offers/${preparedId}/finalize`
    : `/api/membership/purchases/${preparedId}/finalize`;
  return api<PurchaseResult>(path, {
    method: "POST",
    body: JSON.stringify({ signedTransaction }),
  });
}

export async function preparePriceUpdate(
  priceKas: string,
): Promise<PreparedSubscription> {
  return api<PreparedSubscription>("/api/membership/price/prepare", {
    method: "POST",
    body: JSON.stringify({ price: priceKas }),
  });
}

export async function finalizePriceUpdate(
  preparedId: string,
  signedTransaction: string,
): Promise<PurchaseResult> {
  return api<PurchaseResult>(`/api/membership/price/${preparedId}/finalize`, {
    method: "POST",
    body: JSON.stringify({ signedTransaction }),
  });
}

export async function prepareCancellation(): Promise<PreparedSubscription> {
  return api<PreparedSubscription>("/api/membership/cancel/prepare", {
    method: "POST",
  });
}

export async function finalizeCancellation(
  preparedId: string,
  signedTransaction: string,
): Promise<PurchaseResult> {
  return api<PurchaseResult>(`/api/membership/cancel/${preparedId}/finalize`, {
    method: "POST",
    body: JSON.stringify({ signedTransaction }),
  });
}
