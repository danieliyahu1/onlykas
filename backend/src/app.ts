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
  mediaHintError,
  NETWORK,
  normalizePostText,
  parseKasToSompi,
  SESSION_IDLE_TTL_MS,
  UPLOAD_TTL_MS,
  validatePost,
  type PostResponse,
  type UploadResponse,
} from "@onlykas/shared";
import type {
  ObjectStorage,
  Post,
  Session,
  Store,
  WalletVerifier,
} from "./domain.js";

const sessionCookie = "onlykas_session";
const addressPattern = /^kaspatest:[a-z0-9]{40,80}$/;

export interface AppDependencies {
  store: Store;
  storage: ObjectStorage;
  walletVerifier: WalletVerifier;
  publicOrigin: string;
  production?: boolean;
  now?: () => number;
}

declare global {
  // Express exposes request augmentation through this namespace.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      walletSession?: Session;
    }
  }
}

export function createApp(dependencies: AppDependencies) {
  const app = express();
  const now = dependencies.now ?? Date.now;
  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

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
      response.json({
        address,
        displayAddress: shortenAddress(address),
        posts: posts.map((post) =>
          postResponse(post, request.walletSession?.address === post.creator),
        ),
      });
    }),
  );

  app.get(
    "/api/posts/:id",
    optionalSession,
    asyncHandler(async (request, response) => {
      const post = await dependencies.store.getPost(routeParam(request, "id"));
      if (!post) return response.status(404).json({ error: "POST_NOT_FOUND" });
      response.json(
        postResponse(post, request.walletSession?.address === post.creator),
      );
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
      if (request.walletSession!.address !== post.creator)
        return response.status(403).json({ error: "MEDIA_FORBIDDEN" });
      const parsedRange = parseRange(request.headers.range, post.mediaSize);
      if (parsedRange === "invalid") {
        response.setHeader("Content-Range", `bytes */${post.mediaSize}`);
        return response.status(416).end();
      }
      const object = await dependencies.storage.readRange(
        post.mediaKey,
        parsedRange?.start,
        parsedRange?.end,
      );
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
      console.error("[OnlyKas server] unhandled request error", {
        method: request.method,
        path: request.originalUrl,
        name: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
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
