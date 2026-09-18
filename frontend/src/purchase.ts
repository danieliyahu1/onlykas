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

export async function unlockPost(postId: string): Promise<PurchaseResult> {
  const prepared = await api<PreparedTransaction>(
    `/api/posts/${encodeURIComponent(postId)}/payments/prepare`,
    { method: "POST" },
  );
  const signedTransaction = await signPreparedPayment(prepared.transaction);
  return api<PurchaseResult>(`/api/payments/${prepared.id}/finalize`, {
    method: "POST",
    body: JSON.stringify({ signedTransaction }),
  });
}

export async function prepareSubscription(
  actingAsOwner: boolean,
  creatorAddress: string,
): Promise<PreparedSubscription> {
  const path = actingAsOwner
    ? "/api/membership/offers/prepare"
    : `/api/membership/${encodeURIComponent(creatorAddress)}/prepare`;
  return api<PreparedSubscription>(path, { method: "POST" });
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
