import { randomBytes, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { z } from "zod";
import {
  KASPA_TESTNET_ADDRESS_PATTERN,
  isFreePost,
  mediaHintError,
  NETWORK,
  normalizeDisplayName,
  normalizePostText,
  parsePostPrice,
  validateDisplayName,
  type MembershipAddressVerificationResponse,
  type PostResponse,
  MAX_VIDEO_BYTES,
} from "@onlykas/shared";
import {
  CHALLENGE_TTL_MS,
  PREPARED_TTL_MS,
  SESSION_IDLE_TTL_MS,
} from "./application/constants.js";
import {
  createDiscoveryUseCases,
  createProfileUseCases,
  createSessionUseCases,
} from "./application/auth-use-cases.js";
import { API_COPY as COPY } from "./adapters/http/api-copy.js";
import type { CreatorCovenant, Post, Profile, Session } from "./domain/models.js";
import type {
  MembershipGateway,
  MembershipVerifier,
  ObjectStorage,
  PaymentGateway,
  Repositories,
  WalletVerifier,
} from "./application/ports.js";
import {
  safeError,
  logger as defaultLogger,
  requestId,
  type Logger,
} from "./observability.js";
import { defaultMetrics, type Metrics } from "./metrics.js";
import {
  MediaValidationError,
  verifyMediaFile,
  type VerifiedMedia,
} from "./adapters/media/media.js";
import { FeedbackError, type FeedbackService } from "./adapters/feedback/feedback.js";
import { RateLimiter } from "./adapters/http/rate-limit.js";
import { createPublishPostUseCase } from "./application/publication-use-cases.js";
import { createDeletePostUseCase } from "./application/delete-post.js";
import { MembershipAccess } from "./application/membership-access.js";
import { StorageError } from "./r2-storage.js";
import { discardTempDir } from "./temp-files.js";

const sessionCookie = "onlykas_session";
const addressPattern = KASPA_TESTNET_ADDRESS_PATTERN;
export interface AppDependencies {
  store: Repositories;
  storage: ObjectStorage;
  walletVerifier: WalletVerifier;
  verifyMedia?: (path: string) => Promise<VerifiedMedia>;
  paymentGateway?: PaymentGateway;
  membershipGateway?: MembershipGateway;
  membershipVerifier?: MembershipVerifier;
  publicOrigin: string;
  production?: boolean;
  now?: () => number;
  readinessCheck?: () => boolean | Promise<boolean>;
  logger?: Logger;
  metrics?: Metrics;
  feedbackService?: FeedbackService;
  feedbackRateLimiter?: RateLimiter;
}
declare global {
  // Express request augmentation is required by the auth middleware.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      walletSession?: Session;
      requestId: string;
    }
  }
}

export function createApp(d: AppDependencies) {
  const app = express();
  const now = d.now ?? Date.now;
  const logger = d.logger ?? defaultLogger;
  const metrics = d.metrics ?? defaultMetrics;
  // Long-window per-client cap for anonymous feedback.
  const feedbackLimiter =
    d.feedbackRateLimiter ?? new RateLimiter({ limit: 5, windowMs: 10 * 60_000 });
  const sessions = createSessionUseCases({
    challenges: d.store,
    sessions: d.store,
    walletVerifier: d.walletVerifier,
    now,
    createId: () => randomUUID(),
    createNonce: () => randomBytes(32).toString("hex"),
    challengeTtlMs: CHALLENGE_TTL_MS,
    sessionIdleTtlMs: SESSION_IDLE_TTL_MS,
  });
  const profiles = createProfileUseCases({
    profiles: d.store,
    normalizeDisplayName,
    validateDisplayName,
  });
  const discovery = createDiscoveryUseCases({ profiles: d.store });
  const membershipAccess = new MembershipAccess(d.store, d.store, d.membershipVerifier);
  const publishPost = createPublishPostUseCase({
    posts: d.store,
    storage: d.storage,
    verifyMedia: d.verifyMedia ?? verifyMediaFile,
    createId: randomUUID,
    pendingTtlMs: PREPARED_TTL_MS,
  });
  const deletePost = createDeletePostUseCase({
    posts: d.store,
    storage: d.storage,
    logger,
  });
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const startedHr = process.hrtime.bigint();
    if (req.method === "GET" && req.path === "/") metrics.recordHomepageVisit();
    metrics.httpRequestStarted();
    res.on("finish", () => {
      metrics.httpRequestFinished({
        method: req.method,
        route: routePattern(req) ?? "unmatched",
        statusCode: res.statusCode,
        durationSeconds: Number(process.hrtime.bigint() - startedHr) / 1e9,
      });
    });
    next();
  });
  app.use((req, res, next) => {
    req.requestId = requestId(req.get("x-request-id"));
    res.locals.requestId = req.requestId;
    res.setHeader("X-Request-Id", req.requestId);
    const startedAt = Date.now();
    res.on("finish", () => {
      if (req.path.startsWith("/api/")) {
        const write =
          res.statusCode >= 500
            ? logger.error
            : res.statusCode >= 400
              ? logger.warn
              : logger.info;
        write("request_completed", {
          requestId: req.requestId,
          method: req.method,
          path: req.path,
          route: routePattern(req),
          statusCode: res.statusCode,
          durationMs: Date.now() - startedAt,
          authenticated: Boolean(req.walletSession),
          ...(res.locals.apiErrorCode ? { errorCode: res.locals.apiErrorCode } : {}),
          ...(req.params?.id ? { postId: req.params.id } : {}),
        });
      }
    });
    next();
  });
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.get("/healthz", (_, res) => res.json({ status: "ok" }));
  app.get(
    "/readyz",
    asyncHandler(async (_, res) => {
      const ready = await (d.readinessCheck?.() ?? true);
      res.status(ready ? 200 : 503).json({ status: ready ? "ok" : "unready" });
    }),
  );
  async function optional(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.cookies[sessionCookie] as string | undefined;
      if (!id) return next();
      const session = await sessions.getSession(id, now());
      if (!session) {
        res.clearCookie(sessionCookie);
        return next();
      }
      const expiresAt = now() + SESSION_IDLE_TTL_MS;
      const refreshed = await sessions.refreshSession(id, now(), expiresAt);
      if (!refreshed) {
        res.clearCookie(sessionCookie);
        return next();
      }
      req.walletSession = refreshed;
      setCookie(res, id, Boolean(d.production));
      next();
    } catch (e) {
      next(e);
    }
  }
  const required = (req: Request, res: Response, next: NextFunction) =>
    req.walletSession ? next() : apiError(res, 401, "AUTHENTICATION_REQUIRED");
  app.post(
    "/api/auth/challenge",
    asyncHandler(async (req, res) => {
      const b = z.object({ address: z.string().regex(addressPattern) }).parse(req.body);
      trusted(req, d.publicOrigin);
      await sessions.pruneChallenges(now());
      const result = await sessions.issueChallenge({
        address: b.address,
        origin: d.publicOrigin,
        network: NETWORK,
        prompt: COPY.authPrompt,
      });
      metrics.authChallengeAttempt("created");
      res.status(201).json({
        challengeId: result.challenge.id,
        message: result.challenge.message,
        expiresAt: new Date(result.expiresAt).toISOString(),
      });
    }),
  );
  app.post(
    "/api/auth/session",
    asyncHandler(async (req, res) => {
      trusted(req, d.publicOrigin);
      await sessions.pruneSessions(now());
      const b = z
        .object({
          challengeId: z.string().uuid(),
          address: z.string().regex(addressPattern),
          publicKey: z.string().regex(/^[0-9a-fA-F]{64,66}$/),
          signature: z.string().min(1),
        })
        .parse(req.body);
      const result = await sessions.authenticate({
        ...b,
        origin: d.publicOrigin,
        network: NETWORK,
      });
      if (result.kind === "VERIFICATION_FAILED") {
        metrics.authSessionAttempt("verification_failed");
        return res.status(401).json({
          error: "WALLET_VERIFICATION_FAILED",
          message: COPY.verificationFailed,
        });
      }
      setCookie(res, result.session.id, Boolean(d.production));
      metrics.authSessionAttempt("created");
      res.status(201).json({
        address: result.session.address,
        expiresAt: new Date(result.session.expiresAt).toISOString(),
      });
    }),
  );
  app.get(
    "/api/auth/session",
    optional,
    asyncHandler(async (req, res) => {
      if (!req.walletSession) return apiError(res, 401, "AUTH_REQUIRED");
      res.json({
        address: req.walletSession.address,
        displayName:
          (await profiles.get(req.walletSession.address))?.displayName ?? null,
        expiresAt: new Date(req.walletSession.expiresAt).toISOString(),
      });
    }),
  );
  app.post(
    "/api/auth/logout",
    optional,
    asyncHandler(async (req, res) => {
      const id = req.cookies[sessionCookie] as string | undefined;
      if (id) await sessions.logout(id);
      res.clearCookie(sessionCookie, cookieOptions(Boolean(d.production)));
      res.status(204).end();
    }),
  );
  app.get(
    "/api/profile",
    optional,
    required,
    asyncHandler(async (req, res) =>
      res.json(
        profileResponse(
          await profiles.get(req.walletSession!.address),
          req.walletSession!.address,
        ),
      ),
    ),
  );
  app.put(
    "/api/profile",
    optional,
    required,
    asyncHandler(async (req, res) => {
      const b = z
        .object({
          displayName: z.string().max(80).optional(),
          isPublic: z.boolean().optional(),
        })
        .refine(
          (value) => value.displayName !== undefined || value.isPublic !== undefined,
        )
        .parse(req.body);
      const result = await profiles.update({
        address: req.walletSession!.address,
        ...(b.displayName !== undefined ? { displayName: b.displayName } : {}),
        ...(b.isPublic !== undefined ? { isPublic: b.isPublic } : {}),
        now: now(),
      });
      if (result.kind === "INVALID_DISPLAY_NAME")
        return apiError(res, 400, "INVALID_DISPLAY_NAME");
      res.json(profileResponse(result.profile, result.profile.address));
    }),
  );
  app.get(
    "/api/creators/search",
    asyncHandler(async (req, res) => {
      const q = z.string().trim().min(1).max(40).parse(req.query.q);
      res.json(
        (await discovery.search(q, 20)).map((p) => ({
          address: p.address,
          displayAddress: shorten(p.address),
          displayName: p.displayName,
        })),
      );
    }),
  );
  app.get(
    "/api/creators/public",
    asyncHandler(async (_, res) =>
      res.json(
        (await discovery.publicCreators(100)).map((p) => ({
          address: p.address,
          displayAddress: shorten(p.address),
          displayName: p.displayName,
        })),
      ),
    ),
  );
  app.post(
    "/api/posts/publish",
    optional,
    required,
    asyncHandler(async (req, res) => {
      const type = req.get("content-type")?.split(";", 1)[0] ?? "",
        caption = req.get("x-onlykas-caption") ?? "",
        price = req.get("x-onlykas-price") ?? "",
        contentLength = Number(req.get("content-length")),
        hint = Number.isSafeInteger(contentLength)
          ? mediaHintError(type, contentLength)
          : undefined;
      if (hint) {
        metrics.mediaPublishAttempt("invalid", "unknown");
        return apiError(res, 422, "INVALID_MEDIA", hint);
      }
      const priceSompi = parsePostPrice(price);
      const errors: string[] = priceSompi !== null ? [] : [COPY.invalidPrice];
      if (!caption.trim()) errors.push("Caption must be between 1 and 280 characters.");
      if ([...caption.trim()].length > 280)
        errors.push("Caption must be between 1 and 280 characters.");
      if (errors.length) {
        metrics.mediaPublishAttempt("invalid", "unknown");
        return res.status(400).json({ error: "INVALID_POST", errors });
      }
      const dir = await mkdtemp(join(tmpdir(), "onlykas-publish-")),
        source = join(dir, "media");
      try {
        const bytesWritten = await writeUpload(req, source, MAX_VIDEO_BYTES);
        if (!bytesWritten) return apiError(res, 400, "INVALID_MEDIA");
        const result = await publishPost({
          creator: req.walletSession!.address,
          caption: normalizePostText(caption),
          priceSompi: priceSompi!.toString(),
          sourcePath: source,
          now: now(),
        });
        if (result.kind === "DUPLICATE") {
          metrics.mediaPublishAttempt("conflict", type || "unknown");
          return apiError(
            res,
            409,
            "MEDIA_ALREADY_PUBLISHED",
            COPY.mediaAlreadyPublished,
            result.post ? { id: result.post.id } : undefined,
          );
        }
        metrics.mediaPublished(result.post.mediaType, result.post.mediaSize);
        res.status(201).json({ id: result.post.id });
      } catch (e) {
        if (e instanceof MediaValidationError) {
          metrics.mediaValidationFailure(e.category);
          metrics.mediaPublishAttempt("invalid", "unknown");
          return apiError(res, 422, e.category);
        }
        metrics.mediaPublishAttempt(
          e instanceof StorageError ? "storage_error" : "error",
          "unknown",
        );
        throw e;
      } finally {
        await discardTempDir(dir, logger);
      }
    }),
  );
  app.get(
    "/api/creators/:address",
    optional,
    asyncHandler(async (req, res) => {
      const address = param(req, "address");
      if (!addressPattern.test(address)) return apiError(res, 400, "INVALID_ADDRESS");
      const viewer = req.walletSession?.address,
        isOwner = viewer === address,
        posts = await d.store.creatorPosts(address),
        offered = Boolean(await d.store.getCreatorCovenant(address)),
        active = Boolean(
          viewer && !isOwner && (await membershipAccess.isActive(viewer, address)),
        ),
        profile = await profiles.get(address);
      const unlocked = new Set(posts.filter((p) => isFreePost(p.priceSompi)).map((p) => p.id));
      if (isOwner || active) {
        for (const p of posts) unlocked.add(p.id);
      } else if (viewer) {
        for (const id of await purchasedPostIds(d, posts, viewer)) unlocked.add(id);
      }
      res.json({
        address,
        displayAddress: shorten(address),
        displayName: profile?.displayName ?? null,
        isPublic: profile?.isPublic ?? false,
        isOwner,
        membership: { offered, active },
        posts: posts.map((p) => postResponse(p, unlocked.has(p.id))),
      });
    }),
  );
  app.get(
    "/api/posts/:id",
    optional,
    asyncHandler(async (req, res) => {
      const p = await d.store.getPost(param(req, "id"));
      if (!p) return apiError(res, 404, "POST_NOT_FOUND");
      const viewer = req.walletSession?.address;
      res.json(
        postResponse(
          p,
          Boolean(
            isFreePost(p.priceSompi) ||
              (viewer &&
                (viewer === p.creator ||
                  (await purchaseAccess(d, p, viewer)) ||
                  (await membershipAccess.isActive(viewer, p.creator)))),
          ),
        ),
      );
    }),
  );
  app.delete(
    "/api/posts/:id",
    optional,
    required,
    asyncHandler(async (req, res) => {
      const result = await deletePost(param(req, "id"), req.walletSession!.address);
      if (result.kind === "NOT_FOUND") return apiError(res, 404, "POST_NOT_FOUND");
      if (result.kind === "FORBIDDEN") return apiError(res, 403, "POST_FORBIDDEN");
      res.status(204).end();
    }),
  );
  app.post(
    "/api/posts/:id/payments/prepare",
    optional,
    required,
    asyncHandler(async (req, res) => {
      if (!d.paymentGateway) throw new HttpError(503, "PAYMENT_UNAVAILABLE");
      const post = await d.store.getPost(param(req, "id"));
      if (!post) {
        metrics.paymentPrepareAttempt("post_not_found");
        return apiError(res, 404, "POST_NOT_FOUND");
      }
      const buyer = req.walletSession!.address;
      if (
        buyer === post.creator ||
        isFreePost(post.priceSompi) ||
        (await d.store.getPurchase(post.id, buyer))
      ) {
        metrics.paymentPrepareAttempt("already_unlocked");
        return apiError(res, 409, "ALREADY_UNLOCKED");
      }
      try {
        const prepared = await d.paymentGateway.prepare(post, buyer);
        if (
          prepared.amountSompi !== post.priceSompi ||
          prepared.creator !== post.creator
        ) {
          metrics.paymentPrepareAttempt("template_invalid");
          return apiError(res, 422, "PAYMENT_TEMPLATE_INVALID");
        }
        await d.store.prunePreparedPayments(now());
        const id = randomUUID();
        await d.store.savePreparedPayment({
          id,
          ...prepared,
          postId: post.id,
          buyer,
          expiresAt: now() + PREPARED_TTL_MS,
        });
        metrics.paymentPrepareAttempt("prepared");
        res.status(201).json({
          id,
          transaction: prepared.transaction,
          amountSompi: prepared.amountSompi,
        });
      } catch (e) {
        if (e instanceof Error && e.message === "INSUFFICIENT_FUNDS") {
          metrics.paymentPrepareAttempt("insufficient_funds");
          return apiError(res, 422, "INSUFFICIENT_FUNDS", COPY.insufficientFunds);
        }
        throw e;
      }
    }),
  );
  app.post(
    "/api/payments/:id/finalize",
    optional,
    required,
    asyncHandler(async (req, res) => {
      if (!d.paymentGateway) throw new HttpError(503, "PAYMENT_UNAVAILABLE");
      const id = param(req, "id"),
        prepared = await d.store.getPreparedPayment(id, now());
      if (!prepared || prepared.buyer !== req.walletSession!.address) {
        metrics.paymentFinalizeAttempt("not_found");
        return apiError(res, 404, "PAYMENT_NOT_FOUND");
      }
      const workflow = await d.store.getPaymentWorkflow(id);
      const submission = workflow
        ? workflow.state === "CONFIRMED"
          ? {
              isAccepted: true as const,
              transactionId: workflow.transactionId,
              rejection: workflow.rejection,
            }
          : await d.paymentGateway.status(workflow.transactionId)
        : await (async () => {
            const body = z
              .object({ signedTransaction: z.string().min(1) })
              .parse(req.body);
            return d.paymentGateway!.submit(prepared, body.signedTransaction);
          })();
      if (submission.isAccepted !== true || !submission.transactionId) {
        if (submission.isAccepted === null) {
          await d.store.savePaymentWorkflow({
            preparedPaymentId: id,
            state: "SUBMITTED",
            transactionId: submission.transactionId ?? workflow?.transactionId ?? "",
            rejection: null,
          });
          metrics.paymentFinalizeAttempt("pending");
          return res.status(202).json({
            state: "PENDING",
            message: COPY.purchasePending,
            transactionId: submission.transactionId,
          });
        }
        await d.store.deletePaymentWorkflow(id);
        await d.store.deletePreparedPayment(id);
        metrics.paymentFinalizeAttempt("rejected");
        return res.status(422).json({
          state: "REJECTED",
          message: COPY.transactionRejected,
          rejection: submission.rejection,
        });
      }
      const purchase = {
        postId: prepared.postId,
        buyer: prepared.buyer,
        transactionId: submission.transactionId,
      };
      await d.store.savePaymentWorkflow({
        preparedPaymentId: id,
        state: "CONFIRMED",
        transactionId: submission.transactionId,
        rejection: null,
      });
      const outcome = await d.store.finalizePurchase(id, purchase);
      if (outcome === "DUPLICATE") {
        await d.store.deletePaymentWorkflow(id);
        metrics.paymentFinalizeAttempt("purchase_exists");
        return apiError(res, 409, "PURCHASE_EXISTS");
      }
      await d.store.deletePaymentWorkflow(id);
      metrics.paymentFinalizeAttempt("confirmed");
      res.status(201).json({
        state: "CONFIRMED",
        transactionId: purchase.transactionId,
        message: COPY.unlocked,
      });
    }),
  );
  app.post(
    "/api/membership/offers/prepare",
    optional,
    required,
    asyncHandler(async (req, res) => {
      if (!d.membershipGateway) throw new HttpError(503, "MEMBERSHIP_UNAVAILABLE");
      const creator = req.walletSession!.address;
      if (await d.store.getCreatorCovenant(creator)) {
        metrics.membershipPrepareAttempt("offer", "offer_exists");
        return apiError(res, 409, "MEMBERSHIP_OFFER_EXISTS");
      }
      const value = await d.membershipGateway.prepareOffer(creator),
        id = randomUUID();
      logger.info("membership_prepare", {
        requestId: req.requestId,
        kind: "offer",
      });
      await d.store.prunePreparedMemberships(now());
      await d.store.savePreparedMembership({
        id,
        ...value,
        creator,
        buyer: creator,
        kind: "offer",
        expiresAt: now() + PREPARED_TTL_MS,
      });
      metrics.membershipPrepareAttempt("offer", "prepared");
      res
        .status(201)
        .json({ id, transaction: value.transaction, signInputs: value.signInputs });
    }),
  );
  app.post(
    "/api/membership/offers/:id/finalize",
    optional,
    required,
    asyncHandler(async (req, res) => {
      if (!d.membershipGateway) throw new HttpError(503, "MEMBERSHIP_UNAVAILABLE");
      const id = param(req, "id"),
        value = await d.store.getPreparedMembership(id, now());
      if (
        !value ||
        value.kind !== "offer" ||
        value.creator !== req.walletSession!.address
      ) {
        metrics.membershipFinalizeAttempt("offer", "not_found");
        return apiError(res, 404, "MEMBERSHIP_OFFER_NOT_FOUND");
      }
      const body = z.object({ signedTransaction: z.string().min(1) }).parse(req.body);
      logger.info("membership_finalize", {
        requestId: req.requestId,
        kind: "offer",
      });
      const submission = await d.membershipGateway.submit(
        value,
        body.signedTransaction,
      );
      if (submission.isAccepted !== true || !submission.transactionId) {
        if (submission.isAccepted === null && submission.transactionId) {
          await d.store.saveMembershipWorkflow({
            preparedMembershipId: id,
            state: "SUBMITTED",
            transactionId: submission.transactionId,
            rejection: null,
          });
        } else {
          await d.store.deleteMembershipWorkflow(id);
          await d.store.deletePreparedMembership(id);
        }
        metrics.membershipFinalizeAttempt(
          "offer",
          submission.isAccepted === null ? "pending" : "rejected",
        );
        return res.status(submission.isAccepted === null ? 202 : 422).json({
          state: submission.isAccepted === null ? "PENDING" : "REJECTED",
          transactionId: submission.transactionId,
          rejection: submission.rejection,
        });
      }
      const mapping: CreatorCovenant = {
        creator: value.creator,
        covenantId: value.covenantId,
      };
      const outcome = await d.store.finalizeOffer(id, mapping);
      await d.store.saveMembershipWorkflow({
        preparedMembershipId: id,
        state: "CONFIRMED",
        transactionId: submission.transactionId,
        rejection: null,
      });
      if (outcome === "DUPLICATE") {
        await d.store.deleteMembershipWorkflow(id);
        return apiError(res, 409, "MEMBERSHIP_OFFER_EXISTS");
      }
      await d.store.deleteMembershipWorkflow(id);
      metrics.membershipFinalizeAttempt("offer", "confirmed");
      res.status(201).json({
        state: "CONFIRMED",
        transactionId: submission.transactionId,
        covenantId: value.covenantId,
      });
    }),
  );
  app.post(
    "/api/membership/:creator/prepare",
    optional,
    required,
    asyncHandler(async (req, res) => {
      if (!d.membershipGateway) throw new HttpError(503, "MEMBERSHIP_UNAVAILABLE");
      const creator = param(req, "creator");
      if (!addressPattern.test(creator)) {
        metrics.membershipPrepareAttempt("purchase", "invalid_address");
        return apiError(res, 400, "INVALID_ADDRESS");
      }
      const buyer = req.walletSession!.address;
      if (buyer === creator) {
        metrics.membershipPrepareAttempt("purchase", "creator_cannot_subscribe");
        return apiError(res, 409, "CREATOR_CANNOT_SUBSCRIBE");
      }
      const mapping = await d.store.getCreatorCovenant(creator);
      if (!mapping) {
        metrics.membershipPrepareAttempt("purchase", "offer_not_found");
        return apiError(res, 404, "MEMBERSHIP_OFFER_NOT_FOUND");
      }
      const value = await d.membershipGateway.prepareMint(
          creator,
          buyer,
          mapping.covenantId,
        ),
        id = randomUUID();
      logger.info("membership_prepare", {
        requestId: req.requestId,
        kind: "purchase",
      });
      await d.store.prunePreparedMemberships(now());
      await d.store.savePreparedMembership({
        id,
        ...value,
        creator,
        buyer,
        kind: "purchase",
        expiresAt: now() + PREPARED_TTL_MS,
      });
      metrics.membershipPrepareAttempt("purchase", "prepared");
      res
        .status(201)
        .json({ id, transaction: value.transaction, signInputs: value.signInputs });
    }),
  );
  app.post(
    "/api/membership/purchases/:id/finalize",
    optional,
    required,
    asyncHandler(async (req, res) => {
      if (!d.membershipGateway || !d.membershipVerifier)
        throw new HttpError(503, "MEMBERSHIP_UNAVAILABLE");
      const id = param(req, "id"),
        value = await d.store.getPreparedMembership(id, now());
      if (
        !value ||
        value.kind !== "purchase" ||
        value.buyer !== req.walletSession!.address
      ) {
        metrics.membershipFinalizeAttempt("purchase", "not_found");
        return apiError(res, 404, "MEMBERSHIP_PURCHASE_NOT_FOUND");
      }
      const body = z.object({ signedTransaction: z.string().min(1) }).parse(req.body);
      logger.info("membership_finalize", {
        requestId: req.requestId,
        kind: "purchase",
      });
      const submission = await d.membershipGateway.submit(
        value,
        body.signedTransaction,
      );
      if (submission.isAccepted !== true || !submission.transactionId) {
        if (submission.isAccepted === null && submission.transactionId) {
          await d.store.saveMembershipWorkflow({
            preparedMembershipId: id,
            state: "SUBMITTED",
            transactionId: submission.transactionId,
            rejection: null,
          });
        } else {
          await d.store.deleteMembershipWorkflow(id);
          await d.store.deletePreparedMembership(id);
        }
        metrics.membershipFinalizeAttempt(
          "purchase",
          submission.isAccepted === null ? "pending" : "rejected",
        );
        return res.status(submission.isAccepted === null ? 202 : 422).json({
          state: submission.isAccepted === null ? "PENDING" : "REJECTED",
          transactionId: submission.transactionId,
          rejection: submission.rejection,
        });
      }
      const check = await d.membershipVerifier.verifyUtxo(
        submission.transactionId,
        value.memberOutputIndex!,
        value.buyer,
        value.covenantId,
        value.creator,
      );
      if (check.status !== "VALID") {
        await d.store.deleteMembershipWorkflow(id);
        await d.store.deletePreparedMembership(id);
        metrics.membershipFinalizeAttempt("purchase", "not_confirmed");
        return res.status(422).json({
          state: "REJECTED",
          error: "MEMBERSHIP_NOT_CONFIRMED",
          membership: check,
        });
      }
      const outcome = await d.store.finalizeMembershipPurchase(id, {
        transactionId: submission.transactionId,
        buyer: value.buyer,
        creator: value.creator,
      });
      await d.store.saveMembershipWorkflow({
        preparedMembershipId: id,
        state: "CONFIRMED",
        transactionId: submission.transactionId,
        rejection: null,
      });
      await d.store.deleteMembershipWorkflow(id);
      if (outcome === "DUPLICATE")
        return apiError(res, 409, "MEMBERSHIP_PURCHASE_EXISTS");
      metrics.membershipFinalizeAttempt("purchase", "confirmed");
      res.status(201).json({
        state: "CONFIRMED",
        transactionId: submission.transactionId,
        membership: check,
      });
    }),
  );
  app.post(
    "/api/membership/purchases/confirm",
    optional,
    required,
    asyncHandler(async (req, res) => {
      if (!d.membershipVerifier) throw new HttpError(503, "VERIFY_UNAVAILABLE");
      const b = z
          .object({
            creator: z.string().regex(addressPattern),
            transactionId: z.string().regex(/^[0-9a-f]{64}$/i),
            outputIndex: z.literal(1),
          })
          .parse(req.body),
        mapping = await d.store.getCreatorCovenant(b.creator);
      if (!mapping) {
        metrics.membershipFinalizeAttempt("purchase", "covenant_not_found");
        return apiError(res, 404, "COVENANT_NOT_FOUND");
      }
      const buyer = req.walletSession!.address,
        check = await d.membershipVerifier.verifyUtxo(
          b.transactionId,
          b.outputIndex,
          buyer,
          mapping.covenantId,
          b.creator,
        );
      if (check.status !== "VALID") {
        metrics.membershipFinalizeAttempt("purchase", "not_confirmed");
        return res
          .status(422)
          .json({ error: "MEMBERSHIP_NOT_CONFIRMED", membership: check });
      }
      const outcome = await d.store.createMembershipPurchase({
        transactionId: b.transactionId,
        buyer,
        creator: b.creator,
      });
      if (outcome === "DUPLICATE")
        return apiError(res, 409, "MEMBERSHIP_PURCHASE_EXISTS");
      metrics.membershipFinalizeAttempt("purchase", "confirmed");
      res.status(201).json(check);
    }),
  );
  app.get(
    "/api/verify/membership/address/:address",
    asyncHandler(async (req, res) => {
      if (!d.membershipVerifier) throw new HttpError(503, "VERIFY_UNAVAILABLE");
      const address = param(req, "address");
      if (!addressPattern.test(address)) return apiError(res, 400, "INVALID_ADDRESS");
      const owner = ownerFrom(req);
      if (owner === "invalid") return apiError(res, 400, "INVALID_ADDRESS");
      const memberships = await d.membershipVerifier.verifyAddress(address, owner),
        body: MembershipAddressVerificationResponse = {
          address,
          verifiedAt: new Date(now()).toISOString(),
          valid: memberships.some((x) => x.status === "VALID"),
          memberships,
        };
      metrics.membershipVerificationAttempt(
        "address",
        body.valid ? "valid" : "invalid",
      );
      res.json(body);
    }),
  );
  app.get(
    "/api/verify/membership/utxo/:transactionId/:outputIndex",
    asyncHandler(async (req, res) => {
      if (!d.membershipVerifier) throw new HttpError(503, "VERIFY_UNAVAILABLE");
      const tx = param(req, "transactionId"),
        index = Number(param(req, "outputIndex"));
      if (!/^[0-9a-f]{64}$/i.test(tx) || !Number.isInteger(index) || index < 0)
        return apiError(res, 400, "INVALID_REQUEST");
      const owner = ownerFrom(req);
      if (owner === "invalid") return apiError(res, 400, "INVALID_ADDRESS");
      const check = await d.membershipVerifier.verifyUtxo(tx, index, owner);
      metrics.membershipVerificationAttempt("utxo", check.status);
      res.json(check);
    }),
  );
  app.all(
    "/api/posts/:id/media",
    optional,
    asyncHandler(async (req, res) => {
      if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).end();
      const p = await d.store.getPost(param(req, "id"));
      if (!p) {
        metrics.mediaDeliveryAttempt(req.method, "not_found", "none");
        return apiError(res, 404, "POST_NOT_FOUND");
      }
      if (!isFreePost(p.priceSompi)) {
        const viewer = req.walletSession?.address;
        if (!viewer) return apiError(res, 401, "AUTHENTICATION_REQUIRED");
        if (
          viewer !== p.creator &&
          !(await purchaseAccess(d, p, viewer)) &&
          !(await membershipAccess.isActive(viewer, p.creator))
        ) {
          metrics.mediaDeliveryAttempt(req.method, "forbidden", "none");
          return apiError(res, 403, "MEDIA_FORBIDDEN");
        }
      }
      const range = parseRange(req.headers.range, p.mediaSize);
      if (range === "invalid") {
        metrics.mediaDeliveryAttempt(req.method, "invalid_range", "invalid");
        res.setHeader("Content-Range", `bytes */${p.mediaSize}`);
        return res.status(416).end();
      }
      const streamed =
        req.method === "GET" && d.storage.streamRange
          ? await d.storage.streamRange(p.mediaKey, range?.start, range?.end)
          : undefined;
      metrics.mediaDeliveryAttempt(req.method, "served", range ? "partial" : "none");
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Type", p.mediaType);
      if (streamed) {
        res.setHeader(
          "Content-Length",
          String(range ? range.end - range.start + 1 : streamed.size),
        );
        if (range) {
          res.status(206);
          res.setHeader(
            "Content-Range",
            `bytes ${range.start}-${range.end}/${p.mediaSize}`,
          );
        }
        const body = Readable.from(streamed.body);
        body.on("data", (chunk: Uint8Array) =>
          metrics.mediaDelivered(p.mediaType, chunk.byteLength),
        );
        return body.pipe(res);
      }
      const object = await d.storage.readRange(p.mediaKey, range?.start, range?.end);
      res.setHeader("Content-Length", object.bytes.byteLength);
      if (range) {
        res.status(206);
        res.setHeader(
          "Content-Range",
          `bytes ${range.start}-${range.end}/${p.mediaSize}`,
        );
      }
      if (req.method === "HEAD") return res.end();
      metrics.mediaDelivered(p.mediaType, object.bytes.byteLength);
      res.send(Buffer.from(object.bytes));
    }),
  );
  if (d.production) {
    const frontend = join(import.meta.dirname, "../../frontend/dist");
    app.use(express.static(frontend));
    app.get("/{*path}", (_, res) => res.sendFile(join(frontend, "index.html")));
  }
  app.post(
    "/api/feedback",
    asyncHandler(async (req, res) => {
      if (!d.feedbackService) throw new HttpError(503, "FEEDBACK_UNAVAILABLE");
      const decision = feedbackLimiter.check(feedbackClientKey(req));
      if (!decision.allowed) {
        res.setHeader("Retry-After", String(decision.retryAfterSeconds));
        return apiError(
          res,
          429,
          "RATE_LIMITED",
          "Too many submissions; please wait a bit before sending more feedback",
        );
      }
      try {
        return res.status(202).json(await d.feedbackService.submit(req.body ?? {}));
      } catch (e) {
        if (e instanceof FeedbackError) return apiError(res, 400, e.code, e.message);
        throw e;
      }
    }),
  );
  app.use((e: unknown, req: Request, res: Response, next: NextFunction) => {
    void next;
    if (e instanceof z.ZodError) return apiError(res, 400, "INVALID_REQUEST");
    if (e instanceof HttpError) return apiError(res, e.status, e.code);
    const storageFailure = e instanceof StorageError;
    logger.error("request_failed", {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      route: routePattern(req),
      errorCode: storageFailure ? "MEDIA_STORAGE_FAILED" : "SERVICE_UNAVAILABLE",
      ...safeError(e),
    });
    return storageFailure
      ? apiError(res, 502, "MEDIA_STORAGE_FAILED")
      : apiError(res, 503, "SERVICE_UNAVAILABLE");
  });
  return app;
}
async function purchaseAccess(d: AppDependencies, post: Post, buyer: string) {
  const receipt = await d.store.getPurchase(post.id, buyer);
  if (!receipt || !d.paymentGateway) return false;
  const metrics = d.metrics ?? defaultMetrics;
  const ok = await d.paymentGateway.verifyPurchase(
    receipt.transactionId,
    buyer,
    post.creator,
    post.priceSompi,
    post.id,
    post.mediaDigest,
  );
  metrics.paymentVerificationAttempt(ok);
  return ok;
}
async function purchasedPostIds(d: AppDependencies, posts: Post[], buyer: string) {
  const unlocked = new Set<string>();
  if (!d.paymentGateway) return unlocked;
  const receipts = await d.store.purchasesForBuyer(buyer),
    byPost = new Map(receipts.map((r) => [r.postId, r]));
  for (const post of posts) {
    const receipt = byPost.get(post.id);
    if (receipt) {
      const metrics = d.metrics ?? defaultMetrics;
      const ok = await d.paymentGateway.verifyPurchase(
        receipt.transactionId,
        buyer,
        post.creator,
        post.priceSompi,
        post.id,
        post.mediaDigest,
      );
      metrics.paymentVerificationAttempt(ok);
      if (ok) unlocked.add(post.id);
    }
  }
  return unlocked;
}
function postResponse(p: Post, canView: boolean): PostResponse {
  return {
    id: p.id,
    creator: p.creator,
    caption: p.caption,
    priceSompi: p.priceSompi,
    mediaType: p.mediaType,
    publishedAt: new Date(p.publishedAt).toISOString(),
    canView,
  };
}
function profileResponse(p: Profile | null, address: string) {
  return {
    address,
    displayAddress: shorten(address),
    displayName: p?.displayName ?? null,
    isPublic: p?.isPublic ?? false,
  };
}
function shorten(a: string) {
  return `${a.slice(0, 16)}...${a.slice(-8)}`;
}
function trusted(req: Request, origin: string) {
  if (req.get("origin") !== origin) throw new HttpError(403, "ORIGIN_MISMATCH");
}
function param(req: Request, n: string) {
  const v = req.params[n];
  if (typeof v !== "string") throw new HttpError(400, "INVALID_REQUEST");
  return v;
}
function ownerFrom(req: Request) {
  const v = req.query.owner;
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !v) return "invalid";
  return addressPattern.test(v) ? v : "invalid";
}
function setCookie(res: Response, id: string, production: boolean) {
  res.cookie(sessionCookie, id, cookieOptions(production));
}
function cookieOptions(production: boolean) {
  return {
    httpOnly: true,
    secure: production,
    sameSite: "strict" as const,
    maxAge: SESSION_IDLE_TTL_MS,
    path: "/",
  };
}
function apiError(
  res: Response,
  status: number,
  code: string,
  message?: string,
  extra?: Record<string, unknown>,
) {
  res.locals.apiErrorCode = code;
  return res.status(status).json({
    error: code,
    message: message ?? `${code.toLowerCase().replaceAll("_", " ")}.`,
    requestId: res.locals.requestId,
    ...(extra ?? {}),
  });
}
function routePattern(req: Request) {
  const route = req.route?.path;
  return typeof route === "string" ? `${req.baseUrl}${route}` : undefined;
}
function feedbackClientKey(req: Request) {
  const forwarded = req.get("x-forwarded-for");
  if (typeof forwarded === "string" && forwarded) {
    return forwarded.split(",")[0]!.trim() || "unknown";
  }
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}
class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res, next).catch(next);
  };
}
function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!m || (!m[1] && !m[2])) return "invalid";
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2])),
    end = m[2] && m[1] ? Number(m[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  )
    return "invalid";
  return { start, end: Math.min(end, size - 1) };
}

async function writeUpload(
  request: Request,
  destination: string,
  maxBytes: number,
): Promise<number> {
  let written = 0;
  const bounded = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      written += chunk.byteLength;
      if (written > maxBytes) {
        callback(new MediaValidationError("VIDEO_TOO_LARGE"));
        return;
      }
      callback(null, chunk);
    },
  });
  await pipeline(request, bounded, createWriteStream(destination, { flags: "wx" }));
  return written;
}
