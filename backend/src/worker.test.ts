import sharp from "sharp";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { UPLOAD_TTL_MS, type MediaType } from "@onlykas/shared";
import { MemoryStore } from "./memory-store.js";
import { TestStorage } from "./test-storage.js";
import {
  cleanupExpiredUploads,
  expireExpiredMemberships,
  processNextUpload,
  reconcilePendingMembershipDeploys,
  reconcilePendingMembershipMints,
  reconcilePendingMembershipTransfers,
  reconcilePendingPayments,
} from "./worker.js";

const ffmpegPath = createRequire(import.meta.url)("ffmpeg-static") as
  string | null;

describe("media jobs", () => {
  it("probes a complete playable video before promotion", async () => {
    if (!ffmpegPath) throw new Error("ffmpeg test binary is unavailable");
    const store = new MemoryStore();
    const storage = new TestStorage();
    const path = join(tmpdir(), `onlykas-video-${randomUUID()}.mp4`);
    try {
      await promisify(execFile)(
        ffmpegPath,
        [
          "-f",
          "lavfi",
          "-i",
          "color=c=black:s=16x16:d=0.1",
          "-an",
          "-c:v",
          "libx264",
          "-movflags",
          "+faststart",
          "-y",
          path,
        ],
        { timeout: 30_000 },
      );
      await seedUpload(
        store,
        storage,
        "video",
        new Uint8Array(await readFile(path)),
      );
      await processNextUpload(store, storage, 2);
      expect(store.uploads.get("video")).toMatchObject({
        state: "VERIFIED",
        mediaType: "video/mp4",
      });
    } finally {
      await rm(path, { force: true });
    }
  });

  it("rejects malformed complete files and keeps storage failures retryable", async () => {
    const store = new MemoryStore();
    const storage = new TestStorage();
    await seedUpload(
      store,
      storage,
      "malformed",
      new TextEncoder().encode("not an image"),
    );
    await processNextUpload(store, storage, 2);
    expect(store.uploads.get("malformed")).toMatchObject({
      state: "REJECTED",
      error: "UNSUPPORTED_MEDIA",
    });

    await seedUpload(store, storage, "missing", new Uint8Array());
    storage.objects.delete("staging/missing");
    await processNextUpload(store, storage, 3);
    expect(store.uploads.get("missing")).toMatchObject({
      state: "UPLOADED",
      error: "STORAGE_FAILURE",
    });
  });

  it("promotes exact bytes by stable BLAKE3 digest and cleans abandoned uploads only", async () => {
    const store = new MemoryStore();
    const storage = new TestStorage();
    const image = new Uint8Array(
      await sharp({
        create: { width: 2, height: 2, channels: 3, background: "white" },
      })
        .jpeg()
        .toBuffer(),
    );
    await seedUpload(store, storage, "valid", image);
    await processNextUpload(store, storage, 10);
    const verified = store.uploads.get("valid")!;
    expect(verified.state).toBe("VERIFIED");
    expect(verified.finalKey).toBe(
      `media/blake3/${verified.digest!.slice(0, 2)}/${verified.digest}`,
    );
    expect(storage.objects.get(verified.finalKey!)?.bytes).toEqual(image);

    await seedUpload(store, storage, "expired", image, 0);
    expect(await cleanupExpiredUploads(store, storage, UPLOAD_TTL_MS + 1)).toBe(
      1,
    );
    expect(store.uploads.get("expired")?.state).toBe("EXPIRED");
    expect(store.uploads.get("valid")?.state).toBe("VERIFIED");
  });

  it("reconciles a submitted payment by status without submitting again", async () => {
    const store = new MemoryStore();
    await store.createPaymentAttempt({
      id: "attempt",
      postId: "post",
      buyer: "buyer",
      amountSompi: "100",
      creator: "creator",
      preparedTransaction: "prepared",
      fingerprint: "fingerprint",
      signedTransactionId: "a".repeat(64),
      state: "PENDING",
      rejection: null,
      submittedAt: 10,
      lastCheckedAt: null,
      reconciliationAttempts: 0,
      createdAt: 1,
      updatedAt: 10,
    });
    let submitCount = 0;
    const gateway = {
      prepare: async () => ({
        transaction: "prepared",
        fingerprint: "fingerprint",
        amountSompi: "100",
        creator: "creator",
      }),
      submit: async () => {
        submitCount += 1;
        throw new Error("must not submit");
      },
      status: async (transactionId: string) => ({
        isAccepted: true,
        transactionId,
        rejection: null,
      }),
    };

    expect(await reconcilePendingPayments(store, gateway, 20)).toBe(1);
    expect(submitCount).toBe(0);
    expect(await store.hasPurchase("post", "buyer")).toBe(true);
    expect((await store.getPaymentAttempt("attempt"))?.state).toBe("CONFIRMED");
  });

  it("confirms an accepted membership offer deploy and records the offer", async () => {
    const store = new MemoryStore();
    await store.createMembershipOfferDeploy({
      id: "deploy",
      creator: "creator",
      priceSompi: "100",
      description: "A day of access",
      covenantId: "covenant-1",
      payoutPk: "payout-pk",
      preparedTransaction: "prepared",
      fingerprint: "fingerprint",
      signedTransactionId: "a".repeat(64),
      state: "PENDING",
      rejection: null,
      submittedAt: 10,
      lastCheckedAt: null,
      reconciliationAttempts: 0,
      createdAt: 1,
      updatedAt: 10,
    });
    const gateway = {
      prepareDeploy: async () => {
        throw new Error("must not prepare");
      },
      submitDeploy: async () => {
        throw new Error("must not submit");
      },
      mint: async () => {
        throw new Error("must not mint");
      },
      transfer: async () => {
        throw new Error("must not transfer");
      },
      submit: async () => {
        throw new Error("must not submit");
      },
      submitMint: async () => {
        throw new Error("must not submit");
      },
      status: async (transactionId: string) => ({
        isAccepted: true,
        transactionId,
        rejection: null,
        acceptedAt: null,
      }),
    };

    expect(await reconcilePendingMembershipDeploys(store, gateway, 20)).toBe(1);
    expect(await store.getMembershipOffer("deploy")).toMatchObject({
      id: "deploy",
      creator: "creator",
      covenantId: "covenant-1",
      priceSompi: "100",
      description: "A day of access",
      isActive: true,
    });
    expect((await store.getMembershipOfferDeploy("deploy"))?.state).toBe(
      "CONFIRMED",
    );
  });

  it("marks a rejected deploy submission and skips unsigned deploys", async () => {
    const store = new MemoryStore();
    await store.createMembershipOfferDeploy({
      id: "unsigned",
      creator: "creator-a",
      priceSompi: "100",
      description: "A day of access",
      covenantId: "covenant-1",
      payoutPk: "payout-pk",
      preparedTransaction: "prepared",
      fingerprint: "fingerprint",
      signedTransactionId: null,
      state: "PENDING",
      rejection: null,
      submittedAt: 10,
      lastCheckedAt: null,
      reconciliationAttempts: 0,
      createdAt: 1,
      updatedAt: 10,
    });
    await store.createMembershipOfferDeploy({
      id: "rejected",
      creator: "creator-b",
      priceSompi: "100",
      description: "A day of access",
      covenantId: "covenant-1",
      payoutPk: "payout-pk",
      preparedTransaction: "prepared",
      fingerprint: "fingerprint",
      signedTransactionId: "b".repeat(64),
      state: "PENDING",
      rejection: null,
      submittedAt: 10,
      lastCheckedAt: null,
      reconciliationAttempts: 0,
      createdAt: 1,
      updatedAt: 10,
    });

    const gateway = {
      prepareDeploy: async () => {
        throw new Error("must not prepare");
      },
      submitDeploy: async () => {
        throw new Error("must not submit");
      },
      mint: async () => {
        throw new Error("must not mint");
      },
      transfer: async () => {
        throw new Error("must not transfer");
      },
      submit: async () => {
        throw new Error("must not submit");
      },
      submitMint: async () => {
        throw new Error("must not submit");
      },
      status: async () => ({
        isAccepted: false,
        transactionId: "b".repeat(64),
        rejection: "TRANSACTION_REJECTED",
        acceptedAt: null,
      }),
    };

    expect(await reconcilePendingMembershipDeploys(store, gateway, 20)).toBe(2);
    expect((await store.getMembershipOfferDeploy("unsigned"))?.state).toBe(
      "PENDING",
    );
    expect(
      (await store.getMembershipOfferDeploy("unsigned"))
        ?.reconciliationAttempts,
    ).toBe(0);
    expect((await store.getMembershipOfferDeploy("rejected"))?.state).toBe(
      "REJECTED",
    );
    expect(
      (await store.getMembershipOfferDeploy("rejected"))?.lastCheckedAt,
    ).toBe(20);
  });
});

describe("membership mint reconciliation", () => {
  function pendingMint(id: string, buyer = "buyer", creator = "creator") {
    return {
      id,
      offerId: "offer-1",
      buyer,
      creator,
      covenantId: "covenant-1",
      priceSompi: "100",
      preparedTransaction: "prepared",
      fingerprint: "fingerprint",
      signedTransactionId: "f".repeat(64),
      state: "PENDING" as const,
      rejection: null,
      submittedAt: 10,
      lastCheckedAt: 10,
      reconciliationAttempts: 0,
      createdAt: 1,
      updatedAt: 10,
    };
  }

  function gatewayWithStatus(
    status: (transactionId: string) => Promise<{
      isAccepted: boolean | null;
      transactionId: string | null;
      rejection: string | null;
      acceptedAt: number | null;
    }>,
  ) {
    return {
      prepareDeploy: async () => {
        throw new Error("must not prepare");
      },
      submitDeploy: async () => {
        throw new Error("must not submit");
      },
      mint: async () => {
        throw new Error("must not mint");
      },
      transfer: async () => {
        throw new Error("must not transfer");
      },
      submit: async () => {
        throw new Error("must not submit");
      },
      submitMint: async () => {
        throw new Error("must not submit");
      },
      status,
    };
  }

  it("confirms an accepted mint and anchors the membership at the funding block time", async () => {
    const store = new MemoryStore();
    await store.createMembershipMintAttempt(pendingMint("mint"));
    const gateway = gatewayWithStatus(async () => ({
      isAccepted: true,
      transactionId: "f".repeat(64),
      rejection: null,
      acceptedAt: 5_000,
    }));

    expect(await reconcilePendingMembershipMints(store, gateway, 20)).toBe(1);
    expect((await store.getMembershipMintAttempt("mint"))?.state).toBe(
      "CONFIRMED",
    );
    const membership = await store.getMembership("mint");
    expect(membership).toMatchObject({
      offerId: "offer-1",
      owner: "buyer",
      creator: "creator",
      covenantId: "covenant-1",
      createdTxId: "f".repeat(64),
      state: "ACTIVE",
    });
    expect(membership?.createdAt).toBe(5_000);
    expect(membership?.validUntil).toBe(5_000 + 24 * 60 * 60 * 1000);
  });

  it("marks a rejected pending mint and keeps quiet on undecided transactions", async () => {
    const store = new MemoryStore();
    await store.createMembershipMintAttempt(pendingMint("mint-a"));
    await store.createMembershipMintAttempt({
      ...pendingMint("mint-b", "buyer-b"),
      signedTransactionId: "e".repeat(64),
    });
    const gateway = gatewayWithStatus(async (transactionId: string) => ({
      isAccepted: transactionId === "f".repeat(64) ? false : null,
      transactionId,
      rejection:
        transactionId === "f".repeat(64) ? "TRANSACTION_REJECTED" : null,
      acceptedAt: null,
    }));

    expect(await reconcilePendingMembershipMints(store, gateway, 30)).toBe(2);
    expect((await store.getMembershipMintAttempt("mint-a"))?.state).toBe(
      "REJECTED",
    );
    expect((await store.getMembershipMintAttempt("mint-a"))?.rejection).toBe(
      "TRANSACTION_REJECTED",
    );
    expect((await store.getMembershipMintAttempt("mint-b"))?.state).toBe(
      "PENDING",
    );
    expect(
      (await store.getMembershipMintAttempt("mint-b"))?.reconciliationAttempts,
    ).toBe(1);
    expect(
      (await store.getMembershipMintAttempt("mint-b"))?.lastCheckedAt,
    ).toBe(30);
  });

  it("expires active memberships past their window and leaves others alone", async () => {
    const store = new MemoryStore();
    const now = 100_000;
    await store.createMembershipMintAttempt(pendingMint("mint"));
    const membership = {
      id: "mint",
      offerId: "offer-1",
      owner: "buyer",
      creator: "creator",
      covenantId: "covenant-1",
      createdTxId: "f".repeat(64),
      validUntil: 10_000,
      state: "ACTIVE" as const,
      createdAt: 1,
      updatedAt: 1,
    };
    await store.confirmMembershipMintAttempt("mint", "PENDING", membership);
    await store.createMembershipMintAttempt({
      ...pendingMint("mint-future"),
      id: "mint-future",
      signedTransactionId: "c".repeat(64),
    });
    const future = {
      id: "mint-future",
      offerId: "offer-1",
      owner: "buyer",
      creator: "creator",
      covenantId: "covenant-1",
      createdTxId: "c".repeat(64),
      validUntil: 200_000,
      state: "ACTIVE" as const,
      createdAt: 1,
      updatedAt: 1,
    };
    await store.confirmMembershipMintAttempt("mint-future", "PENDING", future);

    expect(await expireExpiredMemberships(store, now)).toBe(1);
    expect((await store.getMembership("mint"))?.state).toBe("EXPIRED");
    expect((await store.getMembership("mint-future"))?.state).toBe("ACTIVE");
  });
});

describe("membership transfer reconciliation", () => {
  function pendingTransfer(id: string) {
    return {
      id,
      membershipId: "membership-1",
      seller: "seller",
      buyer: "buyer",
      saleAmountSompi: "500000000",
      creatorRoyaltySompi: "50000000",
      creatorPayoutAddress: "creator",
      preparedTransaction: "prepared",
      fingerprint: "fingerprint",
      signedTransactionId: "f".repeat(64),
      state: "PENDING" as const,
      rejection: null,
      submittedAt: 10,
      lastCheckedAt: 10,
      reconciliationAttempts: 0,
      createdAt: 1,
      updatedAt: 10,
    };
  }

  async function seedMembership(store: MemoryStore) {
    await store.saveCovenant({
      id: "covenant-1",
      templateJson: '{"type":"KCC-0020","amount":1}',
      templateFingerprint: "a".repeat(64),
      amount: "1",
      durationMs: 86400_000,
      creatorRoyaltyBps: 1000,
      createdAt: 1,
    });
    await store.createMembershipOffer({
      id: "offer-1",
      creator: "creator",
      covenantId: "covenant-1",
      priceSompi: "100",
      description: "A day of access",
      isActive: true,
      createdAt: 1,
      updatedAt: 1,
    });
    await store.createMembership({
      id: "membership-1",
      offerId: "offer-1",
      owner: "seller",
      creator: "creator",
      covenantId: "covenant-1",
      createdTxId: null,
      validUntil: 100_000,
      state: "ACTIVE",
      createdAt: 1,
      updatedAt: 1,
    });
  }

  function gatewayWithStatus(
    status: (transactionId: string) => Promise<{
      isAccepted: boolean | null;
      transactionId: string | null;
      rejection: string | null;
      acceptedAt: number | null;
    }>,
  ) {
    return {
      prepareDeploy: async () => {
        throw new Error("must not prepare");
      },
      submitDeploy: async () => {
        throw new Error("must not submit");
      },
      mint: async () => {
        throw new Error("must not mint");
      },
      transfer: async () => {
        throw new Error("must not transfer");
      },
      submit: async () => {
        throw new Error("must not submit");
      },
      submitMint: async () => {
        throw new Error("must not submit");
      },
      status,
    };
  }

  it("confirms an accepted transfer and moves the membership to the buyer", async () => {
    const store = new MemoryStore();
    await seedMembership(store);
    await store.createMembershipTransferAttempt(pendingTransfer("transfer"));
    const gateway = gatewayWithStatus(async () => ({
      isAccepted: true,
      transactionId: "f".repeat(64),
      rejection: null,
      acceptedAt: 5_000,
    }));

    expect(await reconcilePendingMembershipTransfers(store, gateway, 20)).toBe(
      1,
    );
    expect((await store.getMembershipTransferAttempt("transfer"))?.state).toBe(
      "CONFIRMED",
    );
    const membership = await store.getMembership("membership-1");
    expect(membership!.owner).toBe("buyer");
    expect(membership!.state).toBe("ACTIVE");
    expect(membership!.validUntil).toBe(100_000);
  });

  it("marks a rejected pending transfer and keeps quiet on undecided transactions", async () => {
    const store = new MemoryStore();
    await seedMembership(store);
    await store.createMembershipTransferAttempt(pendingTransfer("transfer-a"));
    await store.createMembershipTransferAttempt({
      ...pendingTransfer("transfer-b"),
      signedTransactionId: "e".repeat(64),
    });
    const gateway = gatewayWithStatus(async (transactionId: string) => ({
      isAccepted: transactionId === "f".repeat(64) ? false : null,
      transactionId,
      rejection:
        transactionId === "f".repeat(64) ? "TRANSACTION_REJECTED" : null,
      acceptedAt: null,
    }));

    expect(await reconcilePendingMembershipTransfers(store, gateway, 30)).toBe(
      2,
    );
    expect(
      (await store.getMembershipTransferAttempt("transfer-a"))?.state,
    ).toBe("REJECTED");
    expect(
      (await store.getMembershipTransferAttempt("transfer-a"))?.rejection,
    ).toBe("TRANSACTION_REJECTED");
    expect(
      (await store.getMembershipTransferAttempt("transfer-b"))?.state,
    ).toBe("PENDING");
    expect(
      (await store.getMembershipTransferAttempt("transfer-b"))
        ?.reconciliationAttempts,
    ).toBe(1);
    expect(
      (await store.getMembershipTransferAttempt("transfer-b"))?.lastCheckedAt,
    ).toBe(30);
  });
});

async function seedUpload(
  store: MemoryStore,
  storage: TestStorage,
  id: string,
  bytes: Uint8Array,
  expiresAt = UPLOAD_TTL_MS * 2,
) {
  const stagingKey = `staging/${id}`;
  storage.objects.set(stagingKey, {
    bytes,
    contentType: "application/octet-stream",
  });
  await store.createUpload({
    id,
    creator: "creator",
    stagingKey,
    multipartId: `multipart-${id}`,
    state: "UPLOADED",
    hintedType: "image/jpeg",
    hintedSize: bytes.length,
    expiresAt,
    updatedAt: 1,
    error: null,
    digest: null,
    mediaType: null as MediaType | null,
    mediaSize: null,
    finalKey: null,
    parts: [{ partNumber: 1, etag: "etag" }],
  });
}
