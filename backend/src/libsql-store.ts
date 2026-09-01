import { createClient, type Client, type InValue } from "@libsql/client";
import type {
  Challenge,
  PaymentAttempt,
  PaymentAttemptState,
  PaymentAttemptUpdate,
  Post,
  Purchase,
  Session,
  Store,
  Upload,
  Profile,
} from "./domain.js";

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
        `CREATE TABLE IF NOT EXISTS profiles (address TEXT PRIMARY KEY, display_name TEXT, updated_at INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, creator TEXT NOT NULL, staging_key TEXT NOT NULL UNIQUE, multipart_id TEXT NOT NULL, state TEXT NOT NULL, hinted_type TEXT NOT NULL, hinted_size INTEGER NOT NULL, expires_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, error TEXT, digest TEXT, media_type TEXT, media_size INTEGER, final_key TEXT, parts_json TEXT NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, creator TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, price_sompi TEXT NOT NULL, media_type TEXT NOT NULL, media_size INTEGER NOT NULL, media_digest TEXT NOT NULL UNIQUE, media_key TEXT NOT NULL, published_at INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS payment_attempts (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, buyer TEXT NOT NULL, amount_sompi TEXT NOT NULL, creator TEXT NOT NULL, prepared_transaction TEXT NOT NULL, fingerprint TEXT NOT NULL, signed_transaction_id TEXT, state TEXT NOT NULL, rejection TEXT, submitted_at INTEGER, last_checked_at INTEGER, reconciliation_attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
        `CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_open ON payment_attempts(post_id, buyer) WHERE state IN ('PREPARED','PENDING')`,
        `CREATE TABLE IF NOT EXISTS purchases (post_id TEXT NOT NULL, buyer TEXT NOT NULL, transaction_id TEXT NOT NULL UNIQUE, confirmed_at INTEGER NOT NULL, PRIMARY KEY (post_id, buyer))`,
        `CREATE INDEX IF NOT EXISTS posts_creator_date ON posts (creator, published_at DESC)`,
        `CREATE INDEX IF NOT EXISTS uploads_work ON uploads (state, updated_at)`,
        `CREATE INDEX IF NOT EXISTS uploads_expiry ON uploads (expires_at)`,
      ],
      "write",
    );
    for (const column of [
      "submitted_at INTEGER",
      "last_checked_at INTEGER",
      "reconciliation_attempts INTEGER NOT NULL DEFAULT 0",
    ]) {
      const name = column.split(" ", 1)[0];
      const columns = await this.client.execute(
        `PRAGMA table_info(payment_attempts)`,
      );
      if (!columns.rows.some((row) => row.name === name))
        await this.client.execute(
          `ALTER TABLE payment_attempts ADD COLUMN ${column}`,
        );
    }
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
  async getProfile(address: string): Promise<Profile | null> {
    const result = await this.client.execute({
      sql: `SELECT * FROM profiles WHERE address=?`,
      args: [address],
    });
    return result.rows[0] ? profileFromRow(result.rows[0]) : null;
  }
  async saveProfile(profile: Profile): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO profiles (address, display_name, updated_at) VALUES (?, ?, ?) ON CONFLICT(address) DO UPDATE SET display_name=excluded.display_name, updated_at=excluded.updated_at`,
      args: [profile.address, profile.displayName, profile.updatedAt],
    });
  }
  async searchCreators(name: string, limit: number): Promise<Profile[]> {
    const result = await this.client.execute({
      sql: `SELECT p.* FROM profiles p WHERE p.display_name IS NOT NULL AND lower(p.display_name) LIKE lower(?) AND EXISTS (SELECT 1 FROM posts WHERE creator=p.address) ORDER BY p.display_name, p.address LIMIT ?`,
      args: [`%${name}%`, limit],
    });
    return result.rows.map(profileFromRow);
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
  async commitPublication(
    uploadId: string,
    creator: string,
    post: Post,
  ): Promise<"COMMITTED" | "MEDIA_DIGEST_CONFLICT" | "UPLOAD_STATE_CONFLICT"> {
    const duplicate = await this.client.execute({
      sql: `SELECT 1 FROM posts WHERE media_digest=? LIMIT 1`,
      args: [post.mediaDigest],
    });
    if (duplicate.rows[0]) return "MEDIA_DIGEST_CONFLICT";
    try {
      const results = await this.client.batch(
        [
          {
            sql: `INSERT INTO posts SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM uploads WHERE id=? AND creator=? AND state='VERIFIED'`,
            args: [
              post.id,
              creator,
              post.title,
              post.description,
              post.priceSompi,
              post.mediaType,
              post.mediaSize,
              post.mediaDigest,
              post.mediaKey,
              post.publishedAt,
              uploadId,
              creator,
            ],
          },
          {
            sql: `UPDATE uploads SET state='PUBLISHED', updated_at=? WHERE id=? AND creator=? AND state='VERIFIED'`,
            args: [post.publishedAt, uploadId, creator],
          },
        ],
        "write",
      );
      return results[0]?.rowsAffected === 1 && results[1]?.rowsAffected === 1
        ? "COMMITTED"
        : "UPLOAD_STATE_CONFLICT";
    } catch (error) {
      const conflict = await this.client.execute({
        sql: `SELECT 1 FROM posts WHERE media_digest=? LIMIT 1`,
        args: [post.mediaDigest],
      });
      if (conflict.rows[0]) return "MEDIA_DIGEST_CONFLICT";
      throw error;
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
  async createPaymentAttempt(attempt: PaymentAttempt): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO payment_attempts (id,post_id,buyer,amount_sompi,creator,prepared_transaction,fingerprint,signed_transaction_id,state,rejection,submitted_at,last_checked_at,reconciliation_attempts,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        attempt.id,
        attempt.postId,
        attempt.buyer,
        attempt.amountSompi,
        attempt.creator,
        attempt.preparedTransaction,
        attempt.fingerprint,
        attempt.signedTransactionId,
        attempt.state,
        attempt.rejection,
        attempt.submittedAt,
        attempt.lastCheckedAt,
        attempt.reconciliationAttempts,
        attempt.createdAt,
        attempt.updatedAt,
      ],
    });
  }
  async getPaymentAttempt(id: string): Promise<PaymentAttempt | null> {
    const result = await this.client.execute({
      sql: `SELECT * FROM payment_attempts WHERE id=?`,
      args: [id],
    });
    return result.rows[0] ? paymentAttemptFromRow(result.rows[0]) : null;
  }
  async unresolvedPaymentAttempt(
    postId: string,
    buyer: string,
  ): Promise<PaymentAttempt | null> {
    const result = await this.client.execute({
      sql: `SELECT * FROM payment_attempts WHERE post_id=? AND buyer=? AND state IN ('PREPARED','PENDING')`,
      args: [postId, buyer],
    });
    return result.rows[0] ? paymentAttemptFromRow(result.rows[0]) : null;
  }
  async pendingPaymentAttempts(): Promise<PaymentAttempt[]> {
    const result = await this.client.execute(
      `SELECT * FROM payment_attempts WHERE state='PENDING' ORDER BY updated_at`,
    );
    return result.rows.map(paymentAttemptFromRow);
  }
  async compareAndSetPaymentAttempt(
    id: string,
    expectedState: PaymentAttemptState,
    update: PaymentAttemptUpdate,
  ): Promise<PaymentAttempt | null> {
    const fields = Object.keys(update) as (keyof PaymentAttemptUpdate)[];
    if (!fields.length) return this.getPaymentAttempt(id);
    const names: Record<string, string> = {
      signedTransactionId: "signed_transaction_id",
      state: "state",
      rejection: "rejection",
      submittedAt: "submitted_at",
      lastCheckedAt: "last_checked_at",
      reconciliationAttempts: "reconciliation_attempts",
      updatedAt: "updated_at",
    };
    const values = fields.map((field) => update[field]);
    const result = await this.client.execute({
      sql: `UPDATE payment_attempts SET ${fields.map((field) => `${names[field]}=?`).join(",")} WHERE id=? AND state=?`,
      args: [...values, id, expectedState] as InValue[],
    });
    return result.rowsAffected ? this.getPaymentAttempt(id) : null;
  }
  async confirmPaymentAttempt(
    id: string,
    expectedState: PaymentAttemptState,
    purchase: Purchase,
  ): Promise<PaymentAttempt | null> {
    try {
      const results = await this.client.batch(
        [
          {
            sql: `UPDATE payment_attempts SET signed_transaction_id=?, state='CONFIRMED', submitted_at=COALESCE(submitted_at, ?), last_checked_at=CASE WHEN state='PENDING' THEN ? ELSE last_checked_at END, reconciliation_attempts=reconciliation_attempts + CASE WHEN state='PENDING' THEN 1 ELSE 0 END, updated_at=? WHERE id=? AND state=? AND post_id=? AND buyer=?`,
            args: [
              purchase.transactionId,
              purchase.confirmedAt,
              purchase.confirmedAt,
              purchase.confirmedAt,
              id,
              expectedState,
              purchase.postId,
              purchase.buyer,
            ],
          },
          {
            sql: `INSERT INTO purchases SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM payment_attempts WHERE id=? AND state='CONFIRMED')`,
            args: [
              purchase.postId,
              purchase.buyer,
              purchase.transactionId,
              purchase.confirmedAt,
              id,
            ],
          },
        ],
        "write",
      );
      if (!results[0] || !results[0].rowsAffected) return null;
      return this.getPaymentAttempt(id);
    } catch {
      return null;
    }
  }
  async createPurchase(purchase: Purchase): Promise<boolean> {
    try {
      await this.client.execute({
        sql: `INSERT INTO purchases VALUES (?,?,?,?)`,
        args: [
          purchase.postId,
          purchase.buyer,
          purchase.transactionId,
          purchase.confirmedAt,
        ],
      });
      return true;
    } catch {
      return false;
    }
  }
  async hasPurchase(postId: string, buyer: string): Promise<boolean> {
    const result = await this.client.execute({
      sql: `SELECT 1 FROM purchases WHERE post_id=? AND buyer=?`,
      args: [postId, buyer],
    });
    return Boolean(result.rows[0]);
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
function profileFromRow(row: Record<string, unknown>): Profile {
  return {
    address: text(row.address),
    displayName: nullableText(row.display_name),
    updatedAt: number(row.updated_at),
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
function paymentAttemptFromRow(row: Record<string, unknown>): PaymentAttempt {
  return {
    id: text(row.id),
    postId: text(row.post_id),
    buyer: text(row.buyer),
    amountSompi: text(row.amount_sompi),
    creator: text(row.creator),
    preparedTransaction: text(row.prepared_transaction),
    fingerprint: text(row.fingerprint),
    signedTransactionId: nullableText(row.signed_transaction_id),
    state: text(row.state) as PaymentAttempt["state"],
    rejection: nullableText(row.rejection),
    submittedAt: nullableNumber(row.submitted_at),
    lastCheckedAt: nullableNumber(row.last_checked_at),
    reconciliationAttempts: number(row.reconciliation_attempts),
    createdAt: number(row.created_at),
    updatedAt: number(row.updated_at),
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
