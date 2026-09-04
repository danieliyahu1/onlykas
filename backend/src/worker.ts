import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CovenantGateway,
  MembershipOffer,
  ObjectStorage,
  PaymentGateway,
  Store,
} from "./domain.js";
import { MediaValidationError, verifyMediaFile } from "./media.js";
import { buildMintedMembership } from "./membership.js";
import { logEvent, safeError, type EventLogger } from "./observability.js";

export async function processNextUpload(
  store: Store,
  storage: ObjectStorage,
  now: number = Date.now(),
  staleMs = 300_000,
  logger: EventLogger = logEvent,
): Promise<boolean> {
  let upload;
  try {
    upload = await store.claimUpload(now, now - staleMs);
  } catch (error) {
    logger("media_worker_claim_failed", safeError(error));
    return false;
  }
  if (!upload) return false;
  logger("media_worker_started", { uploadId: upload.id });
  let directory: string;
  try {
    directory = await mkdtemp(join(tmpdir(), "onlykas-"));
  } catch (error) {
    logger("media_worker_setup_failed", {
      uploadId: upload.id,
      ...safeError(error),
    });
    return false;
  }
  const mediaPath = join(directory, "media");
  try {
    await storage.download(upload.stagingKey, mediaPath);
    const media = await verifyMediaFile(mediaPath);
    const finalKey = `media/blake3/${media.digest.slice(0, 2)}/${media.digest}`;
    await storage.promote(upload.stagingKey, finalKey);
    await store.updateUpload({
      ...upload,
      state: "VERIFIED",
      updatedAt: now,
      digest: media.digest,
      mediaType: media.mediaType,
      mediaSize: media.size,
      finalKey,
      error: null,
    });
    logger("media_worker_succeeded", {
      uploadId: upload.id,
      mediaType: media.mediaType,
      mediaSize: media.size,
    });
  } catch (error) {
    const category =
      error instanceof MediaValidationError
        ? error.category
        : "STORAGE_FAILURE";
    try {
      await store.updateUpload({
        ...upload,
        state: category === "STORAGE_FAILURE" ? "UPLOADED" : "REJECTED",
        updatedAt: now,
        error: category,
      });
    } catch (updateError) {
      logger("media_worker_update_failed", {
        uploadId: upload.id,
        ...safeError(updateError),
      });
    }
    logger("media_worker_failed", {
      uploadId: upload.id,
      category,
      ...safeError(error),
    });
  } finally {
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (error) {
      logger("media_worker_cleanup_failed", {
        uploadId: upload.id,
        ...safeError(error),
      });
    }
  }
  return true;
}

export async function cleanupExpiredUploads(
  store: Store,
  storage: ObjectStorage,
  now = Date.now(),
): Promise<number> {
  let uploads;
  try {
    uploads = await store.expiredUploads(now);
  } catch (error) {
    logEvent("media_cleanup_load_failed", safeError(error));
    return 0;
  }
  for (const upload of uploads) {
    try {
      if (upload.state === "CREATED")
        await storage.abortMultipart(upload.stagingKey, upload.multipartId);
      else await storage.delete(upload.stagingKey);
      await store.updateUpload({ ...upload, state: "EXPIRED", updatedAt: now });
      logEvent("media_cleanup_succeeded", { uploadId: upload.id });
    } catch (error) {
      logEvent("media_cleanup_failed", {
        uploadId: upload.id,
        ...safeError(error),
      });
    }
  }
  return uploads.length;
}

export async function reconcilePendingPayments(
  store: Store,
  gateway: PaymentGateway,
  now = Date.now(),
): Promise<number> {
  let attempts;
  try {
    attempts = await store.pendingPaymentAttempts();
  } catch (error) {
    logEvent("payment_reconciliation_load_failed", safeError(error));
    return 0;
  }
  for (const attempt of attempts) {
    if (!attempt.signedTransactionId) continue;
    try {
      const submission = await gateway.status(attempt.signedTransactionId);
      const checkedAt = now;
      if (submission.isAccepted === true) {
        await store.confirmPaymentAttempt(attempt.id, "PENDING", {
          postId: attempt.postId,
          buyer: attempt.buyer,
          transactionId: attempt.signedTransactionId,
          confirmedAt: checkedAt,
        });
      } else if (submission.isAccepted === false) {
        await store.compareAndSetPaymentAttempt(attempt.id, "PENDING", {
          state: "REJECTED",
          rejection: submission.rejection ?? "TRANSACTION_REJECTED",
          lastCheckedAt: checkedAt,
          reconciliationAttempts: attempt.reconciliationAttempts + 1,
          updatedAt: checkedAt,
        });
      } else {
        await store.compareAndSetPaymentAttempt(attempt.id, "PENDING", {
          lastCheckedAt: checkedAt,
          reconciliationAttempts: attempt.reconciliationAttempts + 1,
          updatedAt: checkedAt,
        });
      }
    } catch (error) {
      logEvent("payment_reconciliation_failed", {
        paymentId: attempt.id,
        ...safeError(error),
      });
      try {
        await store.compareAndSetPaymentAttempt(attempt.id, "PENDING", {
          lastCheckedAt: now,
          reconciliationAttempts: attempt.reconciliationAttempts + 1,
          updatedAt: now,
        });
      } catch (updateError) {
        logEvent("payment_reconciliation_update_failed", {
          paymentId: attempt.id,
          ...safeError(updateError),
        });
      }
    }
  }
  return attempts.length;
}

export async function reconcilePendingMembershipDeploys(
  store: Store,
  gateway: CovenantGateway,
  now = Date.now(),
): Promise<number> {
  let deploys;
  try {
    deploys = await store.pendingMembershipOfferDeploys();
  } catch (error) {
    logEvent("membership_deploy_reconciliation_load_failed", safeError(error));
    return 0;
  }
  for (const deploy of deploys) {
    if (!deploy.signedTransactionId) continue;
    try {
      const submission = await gateway.status(deploy.signedTransactionId);
      const checkedAt = now;
      if (submission.isAccepted === true) {
        const offer: MembershipOffer = {
          id: deploy.id,
          creator: deploy.creator,
          covenantId: deploy.covenantId,
          priceSompi: deploy.priceSompi,
          description: deploy.description,
          isActive: true,
          createdAt: checkedAt,
          updatedAt: checkedAt,
        };
        await store.confirmMembershipOfferDeploy(
          deploy.id,
          "PENDING",
          offer,
          deploy.signedTransactionId,
        );
      } else if (submission.isAccepted === false) {
        await store.compareAndSetMembershipOfferDeploy(deploy.id, "PENDING", {
          state: "REJECTED",
          rejection: submission.rejection ?? "TRANSACTION_REJECTED",
          lastCheckedAt: checkedAt,
          reconciliationAttempts: deploy.reconciliationAttempts + 1,
          updatedAt: checkedAt,
        });
      } else {
        await store.compareAndSetMembershipOfferDeploy(deploy.id, "PENDING", {
          lastCheckedAt: checkedAt,
          reconciliationAttempts: deploy.reconciliationAttempts + 1,
          updatedAt: checkedAt,
        });
      }
    } catch (error) {
      logEvent("membership_deploy_reconciliation_failed", {
        deployId: deploy.id,
        ...safeError(error),
      });
      try {
        await store.compareAndSetMembershipOfferDeploy(deploy.id, "PENDING", {
          lastCheckedAt: now,
          reconciliationAttempts: deploy.reconciliationAttempts + 1,
          updatedAt: now,
        });
      } catch (updateError) {
        logEvent("membership_deploy_reconciliation_update_failed", {
          deployId: deploy.id,
          ...safeError(updateError),
        });
      }
    }
  }
  return deploys.length;
}

export async function reconcilePendingMembershipMints(
  store: Store,
  gateway: CovenantGateway,
  now = Date.now(),
): Promise<number> {
  let attempts;
  try {
    attempts = await store.pendingMembershipMintAttempts();
  } catch (error) {
    logEvent("membership_mint_reconciliation_load_failed", safeError(error));
    return 0;
  }
  for (const attempt of attempts) {
    if (!attempt.signedTransactionId) continue;
    try {
      const submission = await gateway.status(attempt.signedTransactionId);
      const checkedAt = now;
      if (submission.isAccepted === true) {
        const membership = await buildMintedMembership(
          store,
          attempt,
          submission.acceptedAt,
          now,
        );
        await store.confirmMembershipMintAttempt(
          attempt.id,
          "PENDING",
          membership,
        );
      } else if (submission.isAccepted === false) {
        await store.compareAndSetMembershipMintAttempt(attempt.id, "PENDING", {
          state: "REJECTED",
          rejection: submission.rejection ?? "TRANSACTION_REJECTED",
          lastCheckedAt: checkedAt,
          reconciliationAttempts: attempt.reconciliationAttempts + 1,
          updatedAt: checkedAt,
        });
      } else {
        await store.compareAndSetMembershipMintAttempt(attempt.id, "PENDING", {
          lastCheckedAt: checkedAt,
          reconciliationAttempts: attempt.reconciliationAttempts + 1,
          updatedAt: checkedAt,
        });
      }
    } catch (error) {
      logEvent("membership_mint_reconciliation_failed", {
        mintId: attempt.id,
        ...safeError(error),
      });
      try {
        await store.compareAndSetMembershipMintAttempt(attempt.id, "PENDING", {
          lastCheckedAt: now,
          reconciliationAttempts: attempt.reconciliationAttempts + 1,
          updatedAt: now,
        });
      } catch (updateError) {
        logEvent("membership_mint_reconciliation_update_failed", {
          mintId: attempt.id,
          ...safeError(updateError),
        });
      }
    }
  }
  return attempts.length;
}

export async function expireExpiredMemberships(
  store: Store,
  now = Date.now(),
): Promise<number> {
  try {
    return await store.expireMemberships(now);
  } catch (error) {
    logEvent("membership_expiry_failed", safeError(error));
    return 0;
  }
}
