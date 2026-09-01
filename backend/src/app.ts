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
  CHALLENGE_TTL_MS,
  COPY,
  createChallengeMessage,
  KASPA_TESTNET_ADDRESS_PATTERN,
  mediaHintError,
  NETWORK,
  normalizePostText,
  normalizeDisplayName,
  parseKasToSompi,
  SESSION_IDLE_TTL_MS,
  UPLOAD_TTL_MS,
  validatePost,
  validateDisplayName,
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
} from "./domain.js";
import {
  logEvent,
  requestId,
  safeError,
  type EventLogger,
} from "./observability.js";

const sessionCookie = "onlykas_session";
const addressPattern = KASPA_TESTNET_ADDRESS_PATTERN;

export interface AppDependencies {
  store: Store;
  storage: ObjectStorage;
  walletVerifier: WalletVerifier;
  paymentGateway?: PaymentGateway;
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
      return response.status(401).json({ error: "AUTHENTICATION_REQUIRED" });
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
        return response.status(401).json({ error: "AUTH_REQUIRED" });
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
      if (hintError)
        return response
          .status(422)
          .json({ error: "INVALID_MEDIA", message: hintError });
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
        return response.status(409).json({ error: "INVALID_UPLOAD_STATE" });
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
        return response.status(422).json({ error: "INVALID_PARTS" });
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
    requireSession,
    asyncHandler(async (request, response) => {
      const body = z
        .object({ displayName: z.string().max(80) })
        .parse(request.body);
      const normalizedName = normalizeDisplayName(body.displayName);
      if (Array.from(normalizedName).length > 40)
        return response
          .status(400)
          .json({
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
          description: z.string(),
          priceKas: z.string(),
          permanenceConfirmed: z.literal(true),
        })
        .parse(request.body);
      const errors = validatePost(body.title, body.description, body.priceKas);
      if (errors.length)
        return response
          .status(422)
          .json({ error: "INVALID_POST", messages: errors });
      const upload = await ownedUpload(
        dependencies.store,
        body.uploadId,
        request.walletSession!.address,
      );
      if (
        upload.state !== "VERIFIED" ||
        !upload.mediaType ||
        !upload.mediaSize ||
        !upload.digest ||
        !upload.finalKey
      )
        return response.status(409).json({ error: "UPLOAD_NOT_VERIFIED" });
      const post: Post = {
        id: randomUUID(),
        creator: request.walletSession!.address,
        title: normalizePostText(body.title),
        description: normalizePostText(body.description),
        priceSompi: parseKasToSompi(body.priceKas)!.toString(),
        mediaType: upload.mediaType,
        mediaSize: upload.mediaSize,
        mediaDigest: upload.digest,
        mediaKey: upload.finalKey,
        publishedAt: now(),
      };
      if (!(await dependencies.store.publish(upload.id, post)))
        return response
          .status(409)
          .json({ error: "POST_NOT_PUBLISHED", message: COPY.publishFailed });
      response.status(201).json(postResponse(post, true));
    }),
  );

  app.get(
    "/api/creators/:address",
    optionalSession,
    asyncHandler(async (request, response) => {
      const address = routeParam(request, "address");
      if (!addressPattern.test(address))
        return response.status(400).json({ error: "INVALID_ADDRESS" });
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
      if (!post) return response.status(404).json({ error: "POST_NOT_FOUND" });
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
      if (!post) return response.status(404).json({ error: "POST_NOT_FOUND" });
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
        return response.status(409).json({ error: "ALREADY_UNLOCKED" });
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
        return response.status(404).json({ error: "PAYMENT_NOT_FOUND" });
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
        return response.status(404).json({ error: "PAYMENT_NOT_FOUND" });
      response.json(paymentResponse(attempt));
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
      if (!post) return response.status(404).json({ error: "POST_NOT_FOUND" });
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
        return response.status(403).json({ error: "MEDIA_FORBIDDEN" });
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
        return response.status(400).json({ error: "INVALID_REQUEST" });
      if (error instanceof HttpError)
        return response.status(error.status).json({ error: error.code });
      logger("request_failed", {
        requestId: request.requestId,
        method: request.method,
        path: request.path,
        ...safeError(error),
      });
      response.status(503).json({ error: "SERVICE_UNAVAILABLE" });
    },
  );
  return app;
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
    description: post.description,
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
