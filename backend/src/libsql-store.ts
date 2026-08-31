import { createClient, type Client, type InValue } from "@libsql/client";
import type { Challenge, Post, Session, Store, Upload } from "./domain.js";

export class LibsqlStore implements Store {
  private readonly client: Client;

  constructor(url: string, authToken?: string) {
    this.client = createClient({ url, ...(authToken ? { authToken } : {}) });
  }

  async initialize(): Promise<void> {
    await this.client.batch(
      [
        `CREATE TABLE IF NOT EXISTS auth_challenges (id TEXT PRIMARY KEY, nonce TEXT NOT NULL UNIQUE, address TEXT NOT NULL, origin TEXT NOT NULL, network TEXT NOT NULL, message TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER)`,
        `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, address TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, creator TEXT NOT NULL, staging_key TEXT NOT NULL UNIQUE, multipart_id TEXT NOT NULL, state TEXT NOT NULL, hinted_type TEXT NOT NULL, hinted_size INTEGER NOT NULL, expires_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, error TEXT, digest TEXT, media_type TEXT, media_size INTEGER, final_key TEXT, parts_json TEXT NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, creator TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, price_sompi TEXT NOT NULL, media_type TEXT NOT NULL, media_size INTEGER NOT NULL, media_digest TEXT NOT NULL UNIQUE, media_key TEXT NOT NULL, published_at INTEGER NOT NULL)`,
        `CREATE INDEX IF NOT EXISTS posts_creator_date ON posts (creator, published_at DESC)`,
        `CREATE INDEX IF NOT EXISTS uploads_work ON uploads (state, updated_at)`,
        `CREATE INDEX IF NOT EXISTS uploads_expiry ON uploads (expires_at)`,
      ],
      "write",
    );
  }

  async createChallenge(challenge: Challenge): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO auth_challenges VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        challenge.id,
        challenge.nonce,
        challenge.address,
        challenge.origin,
        challenge.network,
        challenge.message,
        challenge.expiresAt,
        challenge.consumedAt,
      ],
    });
  }

  async consumeChallenge(id: string, now: number): Promise<Challenge | null> {
    const result = await this.client.execute({
      sql: `UPDATE auth_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL AND expires_at > ? RETURNING *`,
      args: [now, id, now],
    });
    return result.rows[0] ? challengeFromRow(result.rows[0]) : null;
  }

  async createSession(session: Session): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO sessions VALUES (?, ?, ?)`,
      args: [session.id, session.address, session.expiresAt],
    });
  }
  async getSession(id: string, now: number): Promise<Session | null> {
    const result = await this.client.execute({
      sql: `SELECT * FROM sessions WHERE id = ? AND expires_at > ?`,
      args: [id, now],
    });
    const row = result.rows[0];
    return row
      ? {
          id: text(row.id),
          address: text(row.address),
          expiresAt: number(row.expires_at),
        }
      : null;
  }
  async rollSession(id: string, expiresAt: number): Promise<void> {
    await this.client.execute({
      sql: `UPDATE sessions SET expires_at = ? WHERE id = ?`,
      args: [expiresAt, id],
    });
  }
  async deleteSession(id: string): Promise<void> {
    await this.client.execute({
      sql: `DELETE FROM sessions WHERE id = ?`,
      args: [id],
    });
  }
  async createUpload(upload: Upload): Promise<void> {
    await this.client.execute(uploadInsert(upload));
  }
  async getUpload(id: string): Promise<Upload | null> {
    const result = await this.client.execute({
      sql: `SELECT * FROM uploads WHERE id = ?`,
      args: [id],
    });
    return result.rows[0] ? uploadFromRow(result.rows[0]) : null;
  }
  async updateUpload(upload: Upload): Promise<void> {
    await this.client.execute({
      sql: `UPDATE uploads SET state=?, updated_at=?, error=?, digest=?, media_type=?, media_size=?, final_key=?, parts_json=? WHERE id=?`,
      args: [
        upload.state,
        upload.updatedAt,
        upload.error,
        upload.digest,
        upload.mediaType,
        upload.mediaSize,
        upload.finalKey,
        JSON.stringify(upload.parts),
        upload.id,
      ],
    });
  }
  async claimUpload(now: number, staleBefore: number): Promise<Upload | null> {
    const selected = await this.client.execute({
      sql: `SELECT id FROM uploads WHERE state='UPLOADED' OR (state='VERIFYING' AND updated_at < ?) ORDER BY updated_at LIMIT 1`,
      args: [staleBefore],
    });
    const id = selected.rows[0]?.id;
    if (typeof id !== "string") return null;
    const claimed = await this.client.execute({
      sql: `UPDATE uploads SET state='VERIFYING', updated_at=? WHERE id=? AND (state='UPLOADED' OR (state='VERIFYING' AND updated_at < ?)) RETURNING *`,
      args: [now, id, staleBefore],
    });
    return claimed.rows[0] ? uploadFromRow(claimed.rows[0]) : null;
  }
  async expiredUploads(now: number): Promise<Upload[]> {
    const result = await this.client.execute({
      sql: `SELECT * FROM uploads WHERE expires_at <= ? AND state NOT IN ('PUBLISHED','EXPIRED')`,
      args: [now],
    });
    return result.rows.map(uploadFromRow);
  }
  async publish(uploadId: string, post: Post): Promise<boolean> {
    try {
      await this.client.batch(
        [
          {
            sql: `INSERT INTO posts SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM uploads WHERE id=? AND creator=? AND state='VERIFIED'`,
            args: [
              post.id,
              post.creator,
              post.title,
              post.description,
              post.priceSompi,
              post.mediaType,
              post.mediaSize,
              post.mediaDigest,
              post.mediaKey,
              post.publishedAt,
              uploadId,
              post.creator,
            ],
          },
          {
            sql: `UPDATE uploads SET state='PUBLISHED', updated_at=? WHERE id=? AND creator=? AND state='VERIFIED'`,
            args: [post.publishedAt, uploadId, post.creator],
          },
        ],
        "write",
      );
      return (await this.getUpload(uploadId))?.state === "PUBLISHED";
    } catch {
      return false;
    }
  }
  async getPost(id: string): Promise<Post | null> {
    const result = await this.client.execute({
      sql: `SELECT * FROM posts WHERE id=?`,
      args: [id],
    });
    return result.rows[0] ? postFromRow(result.rows[0]) : null;
  }
  async creatorPosts(address: string): Promise<Post[]> {
    const result = await this.client.execute({
      sql: `SELECT * FROM posts WHERE creator=? ORDER BY published_at DESC`,
      args: [address],
    });
    return result.rows.map(postFromRow);
  }
}

function uploadInsert(upload: Upload): { sql: string; args: InValue[] } {
  return {
    sql: `INSERT INTO uploads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      upload.id,
      upload.creator,
      upload.stagingKey,
      upload.multipartId,
      upload.state,
      upload.hintedType,
      upload.hintedSize,
      upload.expiresAt,
      upload.updatedAt,
      upload.error,
      upload.digest,
      upload.mediaType,
      upload.mediaSize,
      upload.finalKey,
      JSON.stringify(upload.parts),
    ],
  };
}

function challengeFromRow(row: Record<string, unknown>): Challenge {
  return {
    id: text(row.id),
    nonce: text(row.nonce),
    address: text(row.address),
    origin: text(row.origin),
    network: text(row.network),
    message: text(row.message),
    expiresAt: number(row.expires_at),
    consumedAt: nullableNumber(row.consumed_at),
  };
}
function uploadFromRow(row: Record<string, unknown>): Upload {
  return {
    id: text(row.id),
    creator: text(row.creator),
    stagingKey: text(row.staging_key),
    multipartId: text(row.multipart_id),
    state: text(row.state) as Upload["state"],
    hintedType: text(row.hinted_type),
    hintedSize: number(row.hinted_size),
    expiresAt: number(row.expires_at),
    updatedAt: number(row.updated_at),
    error: nullableText(row.error) as Upload["error"],
    digest: nullableText(row.digest),
    mediaType: nullableText(row.media_type) as Upload["mediaType"],
    mediaSize: nullableNumber(row.media_size),
    finalKey: nullableText(row.final_key),
    parts: JSON.parse(text(row.parts_json)) as Upload["parts"],
  };
}
function postFromRow(row: Record<string, unknown>): Post {
  return {
    id: text(row.id),
    creator: text(row.creator),
    title: text(row.title),
    description: text(row.description),
    priceSompi: text(row.price_sompi),
    mediaType: text(row.media_type) as Post["mediaType"],
    mediaSize: number(row.media_size),
    mediaDigest: text(row.media_digest),
    mediaKey: text(row.media_key),
    publishedAt: number(row.published_at),
  };
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid database text");
  return value;
}
function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}
function number(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "bigint")
    throw new Error("Invalid database number");
  return Number(value);
}
function nullableNumber(value: unknown): number | null {
  return value === null ? null : number(value);
}
