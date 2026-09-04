import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import cookieParser from "cookie-parser";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";
import { z } from "zod";
import {
  COPY,
  CHALLENGE_TTL_MS,
  createChallengeMessage,
  KASPA_TESTNET_ADDRESS_PATTERN,
  mediaHintError,
  NETWORK,
  normalizeDisplayName,
  normalizePostText,
  parseKasToSompi,
  SESSION_IDLE_TTL_MS,
  UPLOAD_TTL_MS,
  validateDisplayName,
  validateMembershipOffer,
  type MembershipDeployResponse,
  type MembershipMintAttemptResponse,
  type MembershipOfferResponse,
  type MembershipResponse,
  type PostResponse,
  type UploadResponse,
} from "@onlykas/shared";
import type {
  ObjectStorage,
  Post,
  Session,
  Store,
  WalletVerifier,
  PaymentGateway,
  PaymentAttempt,
  Profile,
  CovenantGateway,
  Membership,
  MembershipMintAttempt,
  MembershipOffer,
  MembershipOfferDeploy,
} from "./domain.js";
import {
  logEvent,
  requestId,
  safeError,
  type EventLogger,
} from "./observability.js";
import { publishPost } from "./publish-post.js";
import { createMembershipCovenant } from "./covenant.js";
import { buildMintedMembership } from "./membership.js";

const sessionCookie = "onlykas_session";
const addressPattern = KASPA_TESTNET_ADDRESS_PATTERN;
const apiMessages: Record<string, string> = {
  AUTHENTICATION_REQUIRED: "Sign in to continue.",
  AUTH_REQUIRED: "Sign in to continue.",
  INVALID_REQUEST: "That request could not be completed.",
  INVALID_UPLOAD_STATE:
    "This upload is no longer available. Choose the file again.",
  INVALID_PARTS: "The upload could not be completed. Try again.",
  UPLOAD_NOT_FOUND: "This upload could not be found. Choose the file again.",
  UPLOAD_FORBIDDEN: "You cannot publish this upload.",
  UPLOAD_NOT_VERIFIED: "Your media is still being prepared. Try again shortly.",
  INVALID_ADDRESS: COPY.invalidCreatorAddress,
  POST_NOT_FOUND: "This post could not be found.",
  POST_NOT_PUBLISHED: COPY.publishFailed,
  PAYMENT_NOT_FOUND: "This payment could not be found.",
  ALREADY_UNLOCKED: "This post is already unlocked.",
  MEDIA_FORBIDDEN: "You do not have access to this media.",
  PAYMENT_UNAVAILABLE: "Payments are temporarily unavailable. Try again.",
  SERVICE_UNAVAILABLE: "OnlyKas is temporarily unavailable. Try again.",
  MEMBERSHIP_UNAVAILABLE: COPY.membershipUnavailable,
  ALREADY_DEPLOYED: "You already have a live membership offer.",
  DEPLOY_NOT_FOUND: "This membership offer could not be found.",
  OFFER_UNAVAILABLE: "This membership offer is no longer available.",
  MINT_NOT_FOUND: "This membership could not be found.",
  MINT_PRICE_MISMATCH: COPY.membershipPriceMismatch,
};

export interface AppDependencies {
  store: Store;
  storage: ObjectStorage;
  walletVerifier: WalletVerifier;
  paymentGateway?: PaymentGateway;
  covenantGateway?: CovenantGateway;
  publicOrigin: string;
  production?: boolean;
  now?: () => number;
  readinessCheck?: () => boolean | Promise<boolean>;
  logger?: EventLogger;
}

declare global {
  // Express exposes request augmentation through this namespace.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      walletSession?: Session;
      requestId: string;
    }
  }
}

export function createApp(dependencies: AppDependencies) {
  const app = express();
  const now = dependencies.now ?? Date.now;
  const logger = dependencies.logger ?? logEvent;
  app.disable("x-powered-by");
  app.use((request, response, next) => {
    request.requestId = requestId(request.get("x-request-id"));
    response.setHeader("X-Request-Id", request.requestId);
    next();
  });
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.get("/healthz", (_request, response) => response.json({ status: "ok" }));
  app.get(
    "/readyz",
    asyncHandler(async (_request, response) => {
      const ready = await (dependencies.readinessCheck?.() ?? true);
      response
        .status(ready ? 200 : 503)
        .json({ status: ready ? "ok" : "unready" });
    }),
  );

  async function optionalSession(
    request: Request,
    response: Response,
    next: NextFunction,
  ) {
    try {
      const id = request.cookies[sessionCookie] as string | undefined;
      if (!id) return next();
      const session = await dependencies.store.getSession(id, now());
      if (!session) {
        response.clearCookie(sessionCookie);
        return next();
      }
      const expiresAt = now() + SESSION_IDLE_TTL_MS;
      await dependencies.store.rollSession(id, expiresAt);
      request.walletSession = { ...session, expiresAt };
      setSessionCookie(response, id, dependencies.production ?? false);
      next();
    } catch (error) {
      next(error);
    }
  }

  function requireSession(
    request: Request,
    response: Response,
    next: NextFunction,
  ) {
    if (!request.walletSession)
      return apiError(response, 401, "AUTHENTICATION_REQUIRED");
    next();
  }

  app.post(
    "/api/auth/challenge",
    asyncHandler(async (request, response) => {
      const body = z
        .object({ address: z.string().regex(addressPattern) })
        .parse(request.body);
      requireTrustedOrigin(request, dependencies.publicOrigin);
      const issuedAt = now();
      const id = randomUUID();
      const nonce = randomBytes(32).toString("hex");
      const message = createChallengeMessage(
        body.address,
        nonce,
        dependencies.publicOrigin,
      );
      await dependencies.store.createChallenge({
        id,
        nonce,
        address: body.address,
        origin: dependencies.publicOrigin,
        network: NETWORK,
        message,
        expiresAt: issuedAt + CHALLENGE_TTL_MS,
        consumedAt: null,
      });
      response.status(201).json({
        challengeId: id,
        message,
        expiresAt: new Date(issuedAt + CHALLENGE_TTL_MS).toISOString(),
      });
    }),
  );

  app.post(
    "/api/auth/session",
    asyncHandler(async (request, response) => {
      requireTrustedOrigin(request, dependencies.publicOrigin);
      const body = z
        .object({
          challengeId: z.string().uuid(),
          address: z.string().regex(addressPattern),
          publicKey: z.string().regex(/^[0-9a-fA-F]{64,66}$/),
          signature: z.string().min(1),
        })
        .parse(request.body);
      const challenge = await dependencies.store.consumeChallenge(
        body.challengeId,
        now(),
      );
      const valid =
        challenge &&
        challenge.address === body.address &&
        challenge.origin === dependencies.publicOrigin &&
        challenge.network === NETWORK &&
        (await dependencies.walletVerifier.verify(
          challenge.message,
          body.signature,
          body.publicKey,
          body.address,
        ));
      if (!valid)
        return response.status(401).json({
          error: "WALLET_VERIFICATION_FAILED",
          message: COPY.verificationFailed,
        });
      const session = {
        id: randomBytes(32).toString("base64url"),
        address: body.address,
        expiresAt: now() + SESSION_IDLE_TTL_MS,
      };
      await dependencies.store.createSession(session);
      setSessionCookie(response, session.id, dependencies.production ?? false);
      response.status(201).json({
        address: session.address,
        expiresAt: new Date(session.expiresAt).toISOString(),
      });
    }),
  );

  app.get(
    "/api/auth/session",
    optionalSession,
    asyncHandler(async (request, response) => {
      if (!request.walletSession)
        return apiError(response, 401, "AUTH_REQUIRED");
      response.json({
        address: request.walletSession.address,
        displayName:
          (await dependencies.store.getProfile(request.walletSession.address))
            ?.displayName ?? null,
        expiresAt: new Date(request.walletSession.expiresAt).toISOString(),
      });
    }),
  );

  app.post(
    "/api/auth/logout",
    optionalSession,
    asyncHandler(async (request, response) => {
      const id = request.cookies[sessionCookie] as string | undefined;
      if (id) await dependencies.store.deleteSession(id);
      response.clearCookie(
        sessionCookie,
        cookieOptions(dependencies.production ?? false),
      );
      response.status(204).end();
    }),
  );

  app.post(
    "/api/uploads",
    optionalSession,
    requireSession,
    asyncHandler(async (request, response) => {
      const body = z
        .object({
          name: z.string().min(1).max(255),
          type: z.string(),
          size: z.number().int().positive(),
        })
        .parse(request.body);
      const hintError = mediaHintError(body.type, body.size);
      if (hintError) return apiError(response, 422, "INVALID_MEDIA", hintError);
      const createdAt = now();
      const id = randomUUID();
      const stagingKey = `staging/${request.walletSession!.address}/${randomBytes(24).toString("hex")}`;
      const multipartId = await dependencies.storage.createMultipart(
        stagingKey,
        body.type,
      );
      const upload = {
        id,
        creator: request.walletSession!.address,
        stagingKey,
        multipartId,
        state: "CREATED" as const,
        hintedType: body.type,
        hintedSize: body.size,
        expiresAt: createdAt + UPLOAD_TTL_MS,
        updatedAt: createdAt,
        error: null,
        digest: null,
        mediaType: null,
        mediaSize: null,
        finalKey: null,
        parts: [],
      };
      await dependencies.store.createUpload(upload);
      console.info("[OnlyKas upload] upload created", {
        uploadId: id,
        type: body.type,
        size: body.size,
      });
      response.status(201).json(uploadResponse(upload));
    }),
  );

  app.post(
    "/api/uploads/:id/parts",
    optionalSession,
    requireSession,
    asyncHandler(async (request, response) => {
      const body = z
        .object({ partNumber: z.number().int().min(1).max(10_000) })
        .parse(request.body);
      const upload = await ownedUpload(
        dependencies.store,
        routeParam(request, "id"),
        request.walletSession!.address,
      );
      if (upload.state !== "CREATED")
        return apiError(response, 409, "INVALID_UPLOAD_STATE");
      console.info("[OnlyKas upload] signing part", {
        uploadId: upload.id,
        partNumber: body.partNumber,
      });
      response.json({
        partNumber: body.partNumber,
        url: await dependencies.storage.signPart(
          upload.stagingKey,
          upload.multipartId,
          body.partNumber,
        ),
        expiresInSeconds: 300,
      });
    }),
  );

  app.post(
    "/api/uploads/:id/complete",
    optionalSession,
    requireSession,
    asyncHandler(async (request, response) => {
      const body = z
        .object({
          parts: z
            .array(
              z.object({
                partNumber: z.number().int().positive(),
                etag: z.string().min(1),
              }),
            )
            .min(1),
        })
        .parse(request.body);
      const upload = await ownedUpload(
        dependencies.store,
        routeParam(request, "id"),
        request.walletSession!.address,
      );
      if (upload.state !== "CREATED")
        return response.json(uploadResponse(upload));
      const ordered = [...body.parts].sort(
        (a, b) => a.partNumber - b.partNumber,
      );
      if (ordered.some((part, index) => part.partNumber !== index + 1))
        return apiError(response, 422, "INVALID_PARTS");
      console.info("[OnlyKas upload] completing multipart upload", {
        uploadId: upload.id,
        partCount: ordered.length,
      });
      await dependencies.storage.completeMultipart(
        upload.stagingKey,
        upload.multipartId,
        ordered,
      );
      const completed = {
        ...upload,
        state: "UPLOADED" as const,
        parts: ordered,
        updatedAt: now(),
      };
      await dependencies.store.updateUpload(completed);
      console.info("[OnlyKas upload] multipart upload completed", {
        uploadId: upload.id,
        partCount: ordered.length,
      });
      response.json(uploadResponse(completed));
    }),
  );

  app.get(
    "/api/profile",
    optionalSession,
    requireSession,
    asyncHandler(async (request, response) => {
      response.json(
        profileResponse(
          await dependencies.store.getProfile(request.walletSession!.address),
          request.walletSession!.address,
        ),
      );
    }),
  );

  app.put(
    "/api/profile",
    optionalSession,
    requireSession,
    asyncHandler(async (request, response) => {
      const body = z
        .object({ displayName: z.string().max(80) })
        .parse(request.body);
      const normalizedName = normalizeDisplayName(body.displayName);
      if (Array.from(normalizedName).length > 40)
        return response.status(400).json({
          error: "INVALID_DISPLAY_NAME",
          message: "Names can be up to 40 characters.",
        });
      const displayName = validateDisplayName(normalizedName);
      const profile: Profile = {
        address: request.walletSession!.address,
        displayName,
        updatedAt: now(),
      };
      await dependencies.store.saveProfile(profile);
      response.json(profileResponse(profile, profile.address));
    }),
  );

  app.get(
    "/api/creators/search",
    asyncHandler(async (request, response) => {
      const query = z.string().trim().min(1).max(40).parse(request.query.q);
      const profiles = await dependencies.store.searchCreators(query, 20);
      response.json(
        profiles.map((profile) => ({
          address: profile.address,
          displayAddress: shortenAddress(profile.address),
          displayName: profile.displayName,
        })),
      );
    }),
  );

  app.get(
    "/api/uploads/:id",
    optionalSession,
    requireSession,
    asyncHandler(async (request, response) => {
      response.json(
        uploadResponse(
          await ownedUpload(
            dependencies.store,
            routeParam(request, "id"),
            request.walletSession!.address,
          ),
        ),
      );
    }),
  );

  app.post(
    "/api/posts",
    optionalSession,
    requireSession,
    asyncHandler(async (request, response) => {
      const body = z
        .object({
          uploadId: z.string().uuid(),
          title: z.string(),
          caption: z.string(),
          priceKas: z.string(),
          permanenceConfirmed: z.literal(true),
        })
        .parse(request.body);
      const outcome = await publishPost(
        {
          creator: request.walletSession!.address,
          uploadId: body.uploadId,
          title: body.title,
          caption: body.caption,
          priceKas: body.priceKas,
        },
        {
          repository: dependencies.store,
          createId: randomUUID,
          now,
        },
      );
      if (outcome.type === "PUBLISHED")
        return response.status(201).json(postResponse(outcome.post, true));
      if (outcome.type === "INVALID_POST")
        return apiError(
          response,
          422,
          "INVALID_POST",
          outcome.errors.join(" "),
        );
      if (outcome.type === "UPLOAD_NOT_FOUND")
        return apiError(response, 404, "UPLOAD_NOT_FOUND");
      if (outcome.type === "UPLOAD_FORBIDDEN")
        return apiError(response, 403, "UPLOAD_FORBIDDEN");
      if (outcome.type === "UPLOAD_NOT_READY")
        return apiError(response, 409, "UPLOAD_NOT_VERIFIED");
      if (outcome.type === "MEDIA_ALREADY_PUBLISHED")
        return apiError(
          response,
          409,
          "MEDIA_ALREADY_PUBLISHED",
          COPY.mediaAlreadyPublished,
        );
      return apiError(response, 409, "POST_NOT_PUBLISHED");
    }),
  );

  app.get(
    "/api/creators/:address",
    optionalSession,
    asyncHandler(async (request, response) => {
      const address = routeParam(request, "address");
      if (!addressPattern.test(address))
        return apiError(response, 400, "INVALID_ADDRESS");
      const posts = await dependencies.store.creatorPosts(address);
      const viewer = request.walletSession?.address;
      const visible = await Promise.all(
        posts.map(async (post) =>
          postResponse(
            post,
            viewer === post.creator ||
              Boolean(
                viewer &&
                (await dependencies.store.hasPurchase(post.id, viewer)),
              ),
          ),
        ),
      );
      response.json({
        address,
        displayAddress: shortenAddress(address),
        displayName:
          (await dependencies.store.getProfile(address))?.displayName ?? null,
        posts: visible,
      });
    }),
  );

  app.get(
    "/api/posts/:id",
    optionalSession,
    asyncHandler(async (request, response) => {
      const post = await dependencies.store.getPost(routeParam(request, "id"));
      if (!post) return apiError(response, 404, "POST_NOT_FOUND");
      const viewer = request.walletSession?.address;
      response.json(
        postResponse(
          post,
          viewer === post.creator ||
            Boolean(
              viewer && (await dependencies.store.hasPurchase(post.id, viewer)),
            ),
        ),
      );
    }),
  );

  app.post(
    "/api/posts/:id/payments/prepare",
    optionalSession,
    requireSession,
    asyncHandler(async (request, response) => {
      if (!dependencies.paymentGateway)
        throw new HttpError(503, "PAYMENT_UNAVAILABLE");
      const post = await dependencies.store.getPost(routeParam(request, "id"));
      if (!post) return apiError(response, 404, "POST_NOT_FOUND");
      const buyer = request.walletSession!.address;
      logger("payment_prepare_started", {
        requestId: request.requestId,
        postId: post.id,
        buyer,
      });
      if (
        post.creator === buyer ||
        (await dependencies.store.hasPurchase(post.id, buyer))
      )
        return apiError(response, 409, "ALREADY_UNLOCKED");
      const existing = await dependencies.store.unresolvedPaymentAttempt(
        post.id,
        buyer,
      );
      if (existing && validPreparedPayment(existing, post.creator))
        return response.json(paymentResponse(existing));
      if (existing)
        await dependencies.store.compareAndSetPaymentAttempt(
          existing.id,
          "PREPARED",
          {
            state: "REJECTED",
            rejection: "STALE_PREPARATION",
            updatedAt: now(),
          },
        );
      let prepared: Awaited<ReturnType<PaymentGateway["prepare"]>>;
      try {
        prepared = await dependencies.paymentGateway.prepare(post, buyer);
      } catch (error) {
        if (error instanceof Error && error.message === "INSUFFICIENT_FUNDS")
          return response.status(422).json({
            error: "INSUFFICIENT_FUNDS",
            message: COPY.insufficientFunds,
          });
        throw error;
      }
      if (
        prepared.amountSompi !== post.priceSompi ||
        prepared.creator !== post.creator
      )
        throw new HttpError(503, "PAYMENT_UNAVAILABLE");
      const attempt: PaymentAttempt = {
        id: randomUUID(),
        postId: post.id,
        buyer,
        amountSompi: prepared.amountSompi,
        creator: prepared.creator,
        preparedTransaction: prepared.transaction,
        fingerprint: prepared.fingerprint,
        signedTransactionId: null,
        state: "PREPARED",
        rejection: null,
        submittedAt: null,
        lastCheckedAt: null,
        reconciliationAttempts: 0,
        createdAt: now(),
        updatedAt: now(),
      };
      await dependencies.store.createPaymentAttempt(attempt);
      logger("payment_prepared", {
        requestId: request.requestId,
        paymentId: attempt.id,
        postId: attempt.postId,
        buyer: attempt.buyer,
        amountSompi: attempt.amountSompi,
      });
      response.status(201).json(paymentResponse(attempt));
    }),
  );

  app.post(
    "/api/payments/:id/finalize",
    optionalSession,
    requireSession,
    asyncHandler(async (request, response) => {
      if (!dependencies.paymentGateway)
        throw new HttpError(503, "PAYMENT_UNAVAILABLE");
      const attempt = await dependencies.store.getPaymentAttempt(
        routeParam(request, "id"),
      );
      logger("payment_finalize_started", {
        requestId: request.requestId,
        paymentId: routeParam(request, "id"),
        buyer: request.walletSession!.address,
      });
      if (!attempt || attempt.buyer !== request.walletSession!.address)
        return apiError(response, 404, "PAYMENT_NOT_FOUND");
      if (attempt.state === "CONFIRMED")
        return response.json(paymentResponse(attempt));
      if (attempt.state === "PENDING")
        return response
          .status(409)
          .json({ ...paymentResponse(attempt), message: COPY.purchasePending });
      const body = z
        .object({ signedTransaction: z.string().min(1) })
        .parse(request.body);
      let submission;
      try {
        submission = await dependencies.paymentGateway.submit(
          {
            transaction: attempt.preparedTransaction,
            fingerprint: attempt.fingerprint,
            amountSompi: attempt.amountSompi,
            creator: attempt.creator,
          },
          body.signedTransaction,
        );
      } catch (error) {
        const validationFailure =
          error instanceof Error &&
          ["INVALID_INPUT", "INPUT_CHANGED", "UTXO_OWNER_MISMATCH"].includes(
            error.message,
          );
        const failedState = validationFailure ? "REJECTED" : "PENDING";
        const failedMessage = validationFailure
          ? error instanceof Error
            ? error.message
            : "TRANSACTION_REJECTED"
          : null;
        const pending: PaymentAttempt = {
          ...attempt,
          state: failedState,
          rejection: failedMessage,
          signedTransactionId: null,
          submittedAt: validationFailure ? null : now(),
          updatedAt: now(),
        };
        await dependencies.store.compareAndSetPaymentAttempt(
          attempt.id,
          "PREPARED",
          {
            state: pending.state,
            rejection: pending.rejection,
            signedTransactionId: pending.signedTransactionId,
            submittedAt: pending.submittedAt,
            updatedAt: pending.updatedAt,
          },
        );
        return response.status(validationFailure ? 422 : 202).json({
          ...paymentResponse(pending),
          message: validationFailure
            ? COPY.transactionRejected
            : COPY.purchasePending,
        });
      }
      if (submission.isAccepted === true && submission.transactionId) {
        const updated = await dependencies.store.confirmPaymentAttempt(
          attempt.id,
          "PREPARED",
          {
            postId: attempt.postId,
            buyer: attempt.buyer,
            transactionId: submission.transactionId,
            confirmedAt: now(),
          },
        );
        if (!updated) {
          const current = (await dependencies.store.getPaymentAttempt(
            attempt.id,
          ))!;
          return response.status(409).json({
            ...paymentResponse(current),
            message: COPY.purchasePending,
          });
        }
        logger("payment_finalized", {
          requestId: request.requestId,
          paymentId: updated.id,
          state: updated.state,
          transactionId: updated.signedTransactionId,
        });
        return response.json({
          ...paymentResponse(updated),
          message: COPY.unlocked,
        });
      }
      const updated = await dependencies.store.compareAndSetPaymentAttempt(
        attempt.id,
        "PREPARED",
        {
          signedTransactionId: submission.transactionId,
          state: submission.isAccepted === false ? "REJECTED" : "PENDING",
          rejection: submission.rejection,
          submittedAt: submission.transactionId ? now() : null,
          lastCheckedAt: null,
          reconciliationAttempts: 0,
          updatedAt: now(),
        },
      );
      if (!updated) {
        const current = (await dependencies.store.getPaymentAttempt(
          attempt.id,
        ))!;
        return response
          .status(409)
          .json({ ...paymentResponse(current), message: COPY.purchasePending });
      }
      logger("payment_finalized", {
        requestId: request.requestId,
        paymentId: updated.id,
        state: updated.state,
        transactionId: updated.signedTransactionId,
      });
      if (submission.isAccepted === null)
        return response
          .status(202)
          .json({ ...paymentResponse(updated), message: COPY.purchasePending });
      return response.status(422).json({
        ...paymentResponse(updated),
        message: COPY.transactionRejected,
      });
    }),
  );

  app.get(
    "/api/payments/:id",
    optionalSession,
    requireSession,
    asyncHandler(async (request, response) => {
      const attempt = await dependencies.store.getPaymentAttempt(
        routeParam(request, "id"),
      );
      if (!attempt || attempt.buyer !== request.walletSession!.address)
        return apiError(response, 404, "PAYMENT_NOT_FOUND");
      response.json(paymentResponse(attempt));
    }),
  );

  app.post(
    "/api/membership/offers/propose",
    optionalSession,
    requireSession,
    asyncHandler(async (request, response) => {
      if (!dependencies.covenantGateway)
        throw new HttpError(503, "MEMBERSHIP_UNAVAILABLE");
      const creator = request.walletSession!.address;
      const body = z
        .object({
          price: z.string().min(1),
          description: z.string().min(1),
          payoutPk: z.string().regex(/^[0-9a-f]{64}$|^[0-9a-f]{66}$/i),
        })
        .parse(request.body);
      const issues = validateMembershipOffer(body.price, body.description);
      if (issues.length)
        return response
          .status(400)
          .json({ error: "INVALID_OFFER", message: issues[0] });
      const liveOffers = await dependencies.store.creatorMembershipOffers(
        creator,
      );
      if (liveOffers.length)
        return apiError(response, 409, "ALREADY_DEPLOYED");
      logger("membership_offer_deploy_started", {
        requestId: request.requestId,
        creator,
      });
      const priceSompi = parseKasToSompi(body.price)!.toString();
      const description = normalizePostText(body.description);
      const existing =
        await dependencies.store.unresolvedMembershipOfferDeploy(creator);
      if (existing && validPreparedDeploy(existing, priceSompi, description))
        return response.json(membershipDeployResponse(existing, null));
      if (existing)
        await dependencies.store.compareAndSetMembershipOfferDeploy(
          existing.id,
          "PREPARED",
          {
            state: "REJECTED",
            rejection: "STALE_PREPARATION",
            updatedAt: now(),
          },
        );
      const covenant = createMembershipCovenant();
      await dependencies.store.saveCovenant(covenant);
      let prepared;
      try {
        prepared = await dependencies.covenantGateway.prepareDeploy(
          covenant,
          creator,
          body.payoutPk,
        );
      } catch (error) {
        if (error instanceof Error && error.message === "INSUFFICIENT_FUNDS")
          return response.status(422).json({
            error: "INSUFFICIENT_FUNDS",
            message: COPY.insufficientFunds,
          });
        throw error;
      }
      const deploy: MembershipOfferDeploy = {
        id: randomUUID(),
        creator,
        priceSompi,
        description,
        covenantId: prepared.covenantId,
        payoutPk: body.payoutPk,
        preparedTransaction: prepared.transaction,
        fingerprint: prepared.fingerprint,
        signedTransactionId: null,
        state: "PREPARED",
        rejection: null,
        submittedAt: null,
        lastCheckedAt: null,
        reconciliationAttempts: 0,
        createdAt: now(),
        updatedAt: now(),
      };
      await dependencies.store.createMembershipOfferDeploy(deploy);
      logger("membership_deploy_prepared", {
        requestId: request.requestId,
        deployId: deploy.id,
        covenantId: deploy.covenantId,
        creator,
        priceSompi: deploy.priceSompi,
      });
      response.status(201).json(membershipDeployResponse(deploy, null));
    }),
  );

  app.post(
    "/api/membership/deploys/:id/finalize",
    optionalSession,
    requireSession,
    asyncHandler(async (request, response) => {
      if (!dependencies.covenantGateway)
        throw new HttpError(503, "MEMBERSHIP_UNAVAILABLE");
      const creator = request.walletSession!.address;
      const deploy = await dependencies.store.getMembershipOfferDeploy(
        routeParam(request, "id"),
      );
      logger("membership_deploy_finalize_started", {
        requestId: request.requestId,
        deployId: routeParam(request, "id"),
        creator,
      });
      if (!deploy || deploy.creator !== creator)
        return apiError(response, 404, "DEPLOY_NOT_FOUND");
      if (deploy.state === "CONFIRMED") {
        const offer = await dependencies.store.getMembershipOffer(deploy.id);
        return response.json(membershipDeployResponse(deploy, offer));
      }
      if (deploy.state === "PENDING")
        return response.status(409).json({
          ...membershipDeployResponse(deploy, null),
          message: COPY.offerDeployPending,
        });
      const body = z
        .object({ signedTransaction: z.string().min(1) })
        .parse(request.body);
      let submission;
      try {
        submission = await dependencies.covenantGateway.submitDeploy(
          {
            transaction: deploy.preparedTransaction,
            fingerprint: deploy.fingerprint,
            covenantId: deploy.covenantId,
          },
          body.signedTransaction,
        );
      } catch (error) {
        const validationFailure =
          error instanceof Error &&
          ["INVALID_INPUT", "INPUT_CHANGED", "UTXO_OWNER_MISMATCH"].includes(
            error.message,
          );
        const failedState = validationFailure ? "REJECTED" : "PENDING";
        const pending = await dependencies.store.compareAndSetMembershipOfferDeploy(
          deploy.id,
          "PREPARED",
          {
            signedTransactionId: null,
            state: failedState,
            rejection: validationFailure
              ? error instanceof Error
                ? error.message
                : "TRANSACTION_REJECTED"
              : null,
            submittedAt: validationFailure ? null : now(),
            updatedAt: now(),
          },
        );
        return response.status(validationFailure ? 422 : 202).json({
          ...membershipDeployResponse(pending ?? deploy, null),
          message: validationFailure
            ? COPY.transactionRejected
            : COPY.offerDeployPending,
        });
      }
      if (submission.isAccepted === true && submission.transactionId) {
        const offer: MembershipOffer = {
          id: deploy.id,
          creator,
          covenantId: deploy.covenantId,
          priceSompi: deploy.priceSompi,
          description: deploy.description,
          isActive: true,
          createdAt: now(),
          updatedAt: now(),
        };
        const updated = await dependencies.store.confirmMembershipOfferDeploy(
          deploy.id,
          "PREPARED",
          offer,
          submission.transactionId,
        );
        if (!updated) {
          const current =
            (await dependencies.store.getMembershipOfferDeploy(deploy.id))!;
          return response.status(409).json({
            ...membershipDeployResponse(current, null),
            message: COPY.offerDeployPending,
          });
        }
        logger("membership_deploy_finalized", {
          requestId: request.requestId,
          deployId: updated.id,
          transactionId: updated.signedTransactionId,
          covenantId: updated.covenantId,
        });
        return response.json({
          ...membershipDeployResponse(updated, offer),
          message: COPY.offerLive,
        });
      }
      const updated = await dependencies.store.compareAndSetMembershipOfferDeploy(
        deploy.id,
        "PREPARED",
        {
          signedTransactionId: submission.transactionId,
          state: submission.isAccepted === false ? "REJECTED" : "PENDING",
          rejection: submission.rejection,
          submittedAt: submission.transactionId ? now() : null,
          updatedAt: now(),
        },
      );
      if (!updated) {
        const current =
          (await dependencies.store.getMembershipOfferDeploy(deploy.id))!;
        return response.status(409).json({
          ...membershipDeployResponse(current, null),
          message: COPY.offerDeployPending,
        });
      }
      logger("membership_deploy_finalized", {
        requestId: request.requestId,
        deployId: updated.id,
        state: updated.state,
        transactionId: updated.signedTransactionId,
      });
      if (submission.isAccepted === null)
        return response.status(202).json({
          ...membershipDeployResponse(updated, null),
          message: COPY.offerDeployPending,
        });
      return response.status(422).json({
        ...membershipDeployResponse(updated, null),
        message: COPY.transactionRejected,
      });
    }),
  );

  app.get(
    "/api/membership/deploys/:id",
    optionalSession,
    requireSession,
    asyncHandler(async (request, response) => {
      const deploy = await dependencies.store.getMembershipOfferDeploy(
        routeParam(request, "id"),
      );
      if (!deploy || deploy.creator !== request.walletSession!.address)
        return apiError(response, 404, "DEPLOY_NOT_FOUND");
      const offer =
        deploy.state === "CONFIRMED"
          ? await dependencies.store.getMembershipOffer(deploy.id)
          : null;
      response.json(membershipDeployResponse(deploy, offer));
    }),
  );

  app.get(
    "/api/membership/offers",
    optionalSession,
    requireSession,
    asyncHandler(async (request, response) => {
      const offers = await dependencies.store.creatorMembershipOffers(
        request.walletSession!.address,
      );
      response.json({ offers: offers.map(membershipOfferResponse) });
    }),
  );

  app.get(
    "/api/membership/offers/:creator",
    asyncHandler(async (request, response) => {
      const offers = await dependencies.store.creatorMembershipOffers(
        routeParam(request, "creator"),
      );
      response.json({
        offer: offers[0] ? membershipOfferResponse(offers[0]) : null,
      });
    }),
  );

  app.get(
    "/api/membership/offers/:id/memberships",
    optionalSession,
    requireSession,
    asyncHandler(async (request, response) => {
      const offer = await dependencies.store.getMembershipOffer(
        routeParam(request, "id"),
      );
      if (!offer) return apiError(response, 404, "OFFER_UNAVAILABLE");
      const memberships = await dependencies.store.offerMemberships(
        offer.id,
        request.walletSession!.address,
      );
      response.json({ memberships: memberships.map(membershipResponse) });
    }),
  );

  app.post(
    "/api/membership/offers/:id/mints/propose",
    optionalSession,
    requireSession,
    asyncHandler(async (request, response) => {
      if (!dependencies.covenantGateway)
        throw new HttpError(503, "MEMBERSHIP_UNAVAILABLE");
      const offer = await dependencies.store.getMembershipOffer(
        routeParam(request, "id"),
      );
      if (!offer || !offer.isActive)
        return apiError(response, 404, "OFFER_UNAVAILABLE");
      if (!(await dependencies.store.getCovenant(offer.covenantId)))
        throw new HttpError(503, "MEMBERSHIP_UNAVAILABLE");
      const buyer = request.walletSession!.address;
      const existing =
        await dependencies.store.unresolvedMembershipMintAttempt(
          offer.id,
          buyer,
        );
      if (existing?.state === "PENDING")
        return response.status(409).json({
          ...mintResponse(existing, null),
          message: COPY.membershipPending,
        });
      if (existing && validPreparedMint(existing, offer))
        return response.json(mintResponse(existing, null));
      if (existing)
        await dependencies.store.compareAndSetMembershipMintAttempt(
          existing.id,
          "PREPARED",
          {
            state: "REJECTED",
            rejection: "STALE_PREPARATION",
            updatedAt: now(),
          },
        );
      logger("membership_mint_started", {
        requestId: request.requestId,
        offerId: offer.id,
        buyer,
      });
      let prepared;
      try {
        prepared = await dependencies.covenantGateway.mint(offer, buyer);
      } catch (error) {
        if (error instanceof Error && error.message === "INSUFFICIENT_FUNDS")
          return response.status(422).json({
            error: "INSUFFICIENT_FUNDS",
            message: COPY.insufficientFunds,
          });
        throw error;
      }
      if (
        prepared.saleAmountSompi !== offer.priceSompi ||
        prepared.buyer !== buyer ||
        prepared.seller !== offer.creator
      )
        return apiError(response, 400, "MINT_PRICE_MISMATCH");
      const attempt: MembershipMintAttempt = {
        id: randomUUID(),
        offerId: offer.id,
        buyer,
        creator: offer.creator,
        covenantId: offer.covenantId,
        priceSompi: offer.priceSompi,
        preparedTransaction: prepared.transaction,
        fingerprint: prepared.fingerprint,
        signedTransactionId: null,
        state: "PREPARED",
        rejection: null,
        submittedAt: null,
        lastCheckedAt: null,
        reconciliationAttempts: 0,
        createdAt: now(),
        updatedAt: now(),
      };
      await dependencies.store.createMembershipMintAttempt(attempt);
      logger("membership_mint_prepared", {
        requestId: request.requestId,
        mintId: attempt.id,
        offerId: attempt.offerId,
        buyer,
        priceSompi: attempt.priceSompi,
      });
      response.status(201).json(mintResponse(attempt, null));
    }),
  );

  app.post(
    "/api/membership/mints/:id/finalize",
    optionalSession,
    requireSession,
    asyncHandler(async (request, response) => {
      if (!dependencies.covenantGateway)
        throw new HttpError(503, "MEMBERSHIP_UNAVAILABLE");
      const buyer = request.walletSession!.address;
      const attempt = await dependencies.store.getMembershipMintAttempt(
        routeParam(request, "id"),
      );
      logger("membership_mint_finalize_started", {
        requestId: request.requestId,
        mintId: routeParam(request, "id"),
        buyer,
      });
      if (!attempt || attempt.buyer !== buyer)
        return apiError(response, 404, "MINT_NOT_FOUND");
      if (attempt.state === "CONFIRMED") {
        const membership = await dependencies.store.getMembership(attempt.id);
        return response.json(mintResponse(attempt, membership));
      }
      if (attempt.state === "PENDING")
        return response.status(409).json({
          ...mintResponse(attempt, null),
          message: COPY.membershipPending,
        });
      const body = z
        .object({ signedTransaction: z.string().min(1) })
        .parse(request.body);
      let submission;
      try {
        submission = await dependencies.covenantGateway.submitMint(
          {
            transaction: attempt.preparedTransaction,
            fingerprint: attempt.fingerprint,
            saleAmountSompi: attempt.priceSompi,
            creatorRoyaltySompi: attempt.priceSompi,
            seller: attempt.creator,
            buyer,
          },
          body.signedTransaction,
        );
      } catch (error) {
        const validationFailure =
          error instanceof Error &&
          ["INVALID_INPUT", "INPUT_CHANGED", "UTXO_OWNER_MISMATCH"].includes(
            error.message,
          );
        const failedState = validationFailure ? "REJECTED" : "PENDING";
        const pending = await dependencies.store.compareAndSetMembershipMintAttempt(
          attempt.id,
          "PREPARED",
          {
            signedTransactionId: null,
            state: failedState,
            rejection: validationFailure
              ? error instanceof Error
                ? error.message
                : "TRANSACTION_REJECTED"
              : null,
            submittedAt: validationFailure ? null : now(),
            updatedAt: now(),
          },
        );
        return response.status(validationFailure ? 422 : 202).json({
          ...mintResponse(pending ?? attempt, null),
          message: validationFailure
            ? COPY.membershipRejected
            : COPY.membershipPending,
        });
      }
      if (submission.isAccepted === true && submission.transactionId) {
        const created = await buildMintedMembership(
          dependencies.store,
          { ...attempt, signedTransactionId: submission.transactionId },
          submission.acceptedAt,
          now(),
        );
        const updated = await dependencies.store.confirmMembershipMintAttempt(
          attempt.id,
          "PREPARED",
          created,
        );
        if (!updated) {
          const current =
            (await dependencies.store.getMembershipMintAttempt(attempt.id))!;
          const membership =
            current.state === "CONFIRMED"
              ? await dependencies.store.getMembership(current.id)
              : null;
          return response.status(409).json({
            ...mintResponse(current, membership),
            message: COPY.membershipPending,
          });
        }
        logger("membership_mint_finalized", {
          requestId: request.requestId,
          mintId: updated.id,
          transactionId: updated.signedTransactionId,
          offerId: updated.offerId,
          buyer,
        });
        return response.json({
          ...mintResponse(updated, created),
          message: COPY.membershipLive,
        });
      }
      const updated = await dependencies.store.compareAndSetMembershipMintAttempt(
        attempt.id,
        "PREPARED",
        {
          signedTransactionId: submission.transactionId,
          state: submission.isAccepted === false ? "REJECTED" : "PENDING",
          rejection: submission.rejection,
          submittedAt: submission.transactionId ? now() : null,
          updatedAt: now(),
        },
      );
      if (!updated) {
        const current =
          (await dependencies.store.getMembershipMintAttempt(attempt.id))!;
        const membership =
          current.state === "CONFIRMED"
            ? await dependencies.store.getMembership(current.id)
            : null;
        return response.status(409).json({
          ...mintResponse(current, membership),
          message: COPY.membershipPending,
        });
      }
      logger("membership_mint_finalized", {
        requestId: request.requestId,
        mintId: updated.id,
        state: updated.state,
        transactionId: updated.signedTransactionId,
      });
      if (submission.isAccepted === null)
        return response.status(202).json({
          ...mintResponse(updated, null),
          message: COPY.membershipPending,
        });
      return response.status(422).json({
        ...mintResponse(updated, null),
        message: COPY.membershipRejected,
      });
    }),
  );

  app.get(
    "/api/membership/mints/:id",
    optionalSession,
    requireSession,
    asyncHandler(async (request, response) => {
      const attempt = await dependencies.store.getMembershipMintAttempt(
        routeParam(request, "id"),
      );
      if (!attempt || attempt.buyer !== request.walletSession!.address)
        return apiError(response, 404, "MINT_NOT_FOUND");
      const membership =
        attempt.state === "CONFIRMED"
          ? await dependencies.store.getMembership(attempt.id)
          : null;
      response.json(mintResponse(attempt, membership));
    }),
  );

  app.all(
    "/api/posts/:id/media",
    optionalSession,
    requireSession,
    asyncHandler(async (request, response) => {
      if (request.method !== "GET" && request.method !== "HEAD")
        return response.status(405).end();
      const post = await dependencies.store.getPost(routeParam(request, "id"));
      if (!post) return apiError(response, 404, "POST_NOT_FOUND");
      if (
        request.walletSession!.address !== post.creator &&
        !(await dependencies.store.hasPurchase(
          post.id,
          request.walletSession!.address,
        ))
      ) {
        logger("media_access_denied", {
          requestId: request.requestId,
          postId: post.id,
          viewer: request.walletSession!.address,
          reason: "NOT_PURCHASED",
        });
        return apiError(response, 403, "MEDIA_FORBIDDEN");
      }
      logger("media_access_granted", {
        requestId: request.requestId,
        postId: post.id,
        viewer: request.walletSession!.address,
        method: request.method,
      });
      const parsedRange = parseRange(request.headers.range, post.mediaSize);
      if (parsedRange === "invalid") {
        response.setHeader("Content-Range", `bytes */${post.mediaSize}`);
        return response.status(416).end();
      }
      let object;
      try {
        object = await dependencies.storage.readRange(
          post.mediaKey,
          parsedRange?.start,
          parsedRange?.end,
        );
      } catch (error) {
        logger("media_read_failed", {
          requestId: request.requestId,
          postId: post.id,
          viewer: request.walletSession!.address,
          ...safeError(error),
        });
        throw error;
      }
      response.setHeader("Accept-Ranges", "bytes");
      response.setHeader("Content-Type", post.mediaType);
      response.setHeader("Content-Length", object.bytes.byteLength);
      if (parsedRange) {
        response.status(206);
        response.setHeader(
          "Content-Range",
          `bytes ${parsedRange.start}-${parsedRange.end}/${post.mediaSize}`,
        );
      }
      if (request.method === "HEAD") return response.end();
      response.send(Buffer.from(object.bytes));
    }),
  );

  if (dependencies.production) {
    const frontend = join(import.meta.dirname, "../../frontend/dist");
    app.use(express.static(frontend));
    app.get("/{*path}", (_request, response) =>
      response.sendFile(join(frontend, "index.html")),
    );
  }

  app.use(
    (
      error: unknown,
      request: Request,
      response: Response,
      next: NextFunction,
    ) => {
      void next;
      if (error instanceof z.ZodError)
        return apiError(response, 400, "INVALID_REQUEST");
      if (error instanceof HttpError)
        return apiError(response, error.status, error.code);
      logger("request_failed", {
        requestId: request.requestId,
        method: request.method,
        path: request.path,
        ...safeError(error),
      });
      apiError(response, 503, "SERVICE_UNAVAILABLE");
    },
  );
  return app;
}

function apiError(
  response: Response,
  status: number,
  code: string,
  message = apiMessages[code] ?? humanizeErrorCode(code),
) {
  return response.status(status).json({ error: code, message });
}

function humanizeErrorCode(code: string) {
  return `${code
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase())}.`;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
async function ownedUpload(store: Store, id: string, creator: string) {
  const upload = await store.getUpload(id);
  if (!upload) throw new HttpError(404, "UPLOAD_NOT_FOUND");
  if (upload.creator !== creator) throw new HttpError(403, "UPLOAD_FORBIDDEN");
  return upload;
}
function requireTrustedOrigin(request: Request, expected: string) {
  if (request.get("origin") !== expected)
    throw new HttpError(403, "ORIGIN_MISMATCH");
}
function setSessionCookie(response: Response, id: string, production: boolean) {
  response.cookie(sessionCookie, id, cookieOptions(production));
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
function uploadResponse(upload: {
  id: string;
  state: UploadResponse["state"];
  expiresAt: number;
  error: UploadResponse["error"];
}): UploadResponse {
  return {
    id: upload.id,
    state: upload.state,
    expiresAt: new Date(upload.expiresAt).toISOString(),
    error: upload.error,
  };
}
function postResponse(post: Post, canView: boolean): PostResponse {
  return {
    id: post.id,
    creator: post.creator,
    title: post.title,
    caption: post.caption,
    priceSompi: post.priceSompi,
    mediaType: post.mediaType,
    publishedAt: new Date(post.publishedAt).toISOString(),
    canView,
  };
}
function profileResponse(profile: Profile | null, address: string) {
  return {
    address,
    displayAddress: shortenAddress(address),
    displayName: profile?.displayName ?? null,
  };
}
function paymentResponse(attempt: PaymentAttempt) {
  return {
    id: attempt.id,
    state: attempt.state,
    transaction:
      attempt.state === "PREPARED" ? attempt.preparedTransaction : undefined,
    fingerprint: attempt.state === "PREPARED" ? attempt.fingerprint : undefined,
    amountSompi: attempt.amountSompi,
    creator: attempt.creator,
    rejection: attempt.rejection,
    transactionId: attempt.signedTransactionId,
    submittedAt: attempt.submittedAt,
    lastCheckedAt: attempt.lastCheckedAt,
    reconciliationAttempts: attempt.reconciliationAttempts,
  };
}
function validPreparedPayment(
  attempt: PaymentAttempt,
  creator: string,
): boolean {
  try {
    const transaction = JSON.parse(attempt.preparedTransaction) as {
      outputs?: { scriptPublicKey?: string }[];
    };
    return (
      transaction.outputs?.[0]?.scriptPublicKey?.startsWith("000020") ===
        true && attempt.creator === creator
    );
  } catch {
    return false;
  }
}
function membershipOfferResponse(
  offer: MembershipOffer,
): MembershipOfferResponse {
  return {
    id: offer.id,
    creator: offer.creator,
    covenantId: offer.covenantId,
    priceSompi: offer.priceSompi,
    description: offer.description,
    isActive: offer.isActive,
    createdAt: new Date(offer.createdAt).toISOString(),
    updatedAt: new Date(offer.updatedAt).toISOString(),
  };
}
function membershipDeployResponse(
  deploy: MembershipOfferDeploy,
  offer: MembershipOffer | null,
): MembershipDeployResponse {
  const prepared = deploy.state === "PREPARED";
  const response: MembershipDeployResponse = {
    id: deploy.id,
    creator: deploy.creator,
    covenantId: deploy.covenantId,
    priceSompi: deploy.priceSompi,
    description: deploy.description,
    state: deploy.state,
    transactionId: deploy.signedTransactionId,
    rejection: deploy.rejection,
    offer: offer ? membershipOfferResponse(offer) : null,
  };
  if (prepared) {
    response.transaction = deploy.preparedTransaction;
    response.fingerprint = deploy.fingerprint;
  }
  return response;
}
function validPreparedDeploy(
  deploy: MembershipOfferDeploy,
  priceSompi: string,
  description: string,
): boolean {
  return (
    deploy.priceSompi === priceSompi &&
    deploy.description === description
  );
}
function mintResponse(
  attempt: MembershipMintAttempt,
  membership: Membership | null,
): MembershipMintAttemptResponse {
  const prepared = attempt.state === "PREPARED";
  const response: MembershipMintAttemptResponse = {
    id: attempt.id,
    offerId: attempt.offerId,
    creator: attempt.creator,
    covenantId: attempt.covenantId,
    priceSompi: attempt.priceSompi,
    state: attempt.state,
    transactionId: attempt.signedTransactionId,
    rejection: attempt.rejection,
    submittedAt: attempt.submittedAt,
    lastCheckedAt: attempt.lastCheckedAt,
    reconciliationAttempts: attempt.reconciliationAttempts,
    membership: membership ? membershipResponse(membership) : null,
  };
  if (prepared) {
    response.transaction = attempt.preparedTransaction;
    response.fingerprint = attempt.fingerprint;
  }
  return response;
}
function membershipResponse(membership: Membership): MembershipResponse {
  return {
    id: membership.id,
    offerId: membership.offerId,
    owner: membership.owner,
    creator: membership.creator,
    covenantId: membership.covenantId,
    createdTxId: membership.createdTxId,
    createdAt: new Date(membership.createdAt).toISOString(),
    validUntil: new Date(membership.validUntil).toISOString(),
    state: membership.state,
  };
}
function validPreparedMint(
  attempt: MembershipMintAttempt,
  offer: MembershipOffer,
): boolean {
  if (attempt.offerId !== offer.id || attempt.priceSompi !== offer.priceSompi)
    return false;
  try {
    const transaction = JSON.parse(attempt.preparedTransaction) as {
      outputs?: {
        scriptPublicKey?: string;
        covenant?: { type?: string };
      }[];
    };
    return (
      transaction.outputs?.[0]?.covenant?.type === "KCC-0020" &&
      transaction.outputs?.[0]?.scriptPublicKey?.startsWith("000020") ===
        true
    );
  } catch {
    return false;
  }
}
function shortenAddress(address: string) {
  return `${address.slice(0, 16)}...${address.slice(-8)}`;
}
function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return "invalid";
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  let end = match[2] && match[1] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  )
    return "invalid";
  end = Math.min(end, size - 1);
  return { start, end };
}
function asyncHandler(
  handler: (
    request: Request,
    response: Response,
    next: NextFunction,
  ) => Promise<unknown>,
) {
  return (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response, next).catch(next);
  };
}
function routeParam(request: Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== "string") throw new HttpError(400, "INVALID_REQUEST");
  return value;
}
