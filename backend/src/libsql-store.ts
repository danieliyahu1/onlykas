import { randomUUID } from "node:crypto";
import {
  createClient,
  type Client,
  type InStatement,
  type ResultSet,
} from "@libsql/client";
import type {
  Challenge,
  CreatorCovenant,
  MembershipPurchase,
  Post,
  PreparedMembershipRecord,
  PreparedPaymentRecord,
  PaymentWorkflow,
  MembershipWorkflow,
  Profile,
  Purchase,
  Session,
} from "./domain/models.js";
import type { DuplicateOutcome, Repositories } from "./application/ports.js";
import { logger as defaultLogger, type Logger } from "./observability.js";
import { defaultMetrics, type Metrics } from "./metrics.js";
import { applyMigrations } from "./adapters/persistence/migrations.js";
import type { FeedbackEntry, FeedbackOutbox } from "./adapters/feedback/feedback.js";

export class LibsqlStore implements Repositories, FeedbackOutbox {
  private readonly client: Client;
  constructor(
    url: string,
    authToken?: string,
    private readonly logger: Logger = defaultLogger,
    private readonly metrics: Metrics = defaultMetrics,
  ) {
    const databaseUrl = url === "file::memory:" ? `file:kaskama-${randomUUID()}` : url;
    this.client = createClient({
      url: databaseUrl,
      ...(authToken ? { authToken } : {}),
    });
  }
  private execute(statement: InStatement): Promise<ResultSet> {
    return this.metrics.observeDependency("turso", "execute", () =>
      this.client.execute(statement),
    );
  }
  async initialize() {
    await applyMigrations(this.client);
    this.logger.info("database_initialized");
  }
  async isReady(): Promise<boolean> {
    try {
      await this.execute({ sql: "SELECT 1", args: [] });
      return true;
    } catch {
      return false;
    }
  }
  close(): void {
    this.client.close();
  }
  async enqueueFeedback(entry: FeedbackEntry) {
    await this.execute({
      sql: "INSERT INTO feedback_outbox (id,message,received_at) VALUES (?,?,?)",
      args: [entry.id, entry.message, entry.receivedAt],
    });
  }
  async pendingFeedback(): Promise<number> {
    const result = await this.execute({
      sql: "SELECT COUNT(*) AS count FROM feedback_outbox",
      args: [],
    });
    return Number(result.rows[0]?.count ?? 0);
  }
  async claimFeedback(
    limit: number,
    leaseMs: number,
    now = Date.now(),
  ): Promise<FeedbackEntry[]> {
    const result = await this.execute({
      sql: `UPDATE feedback_outbox SET lease_until=?, attempts=attempts+1
        WHERE id IN (SELECT id FROM feedback_outbox
          WHERE lease_until IS NULL OR lease_until<=?
          ORDER BY received_at LIMIT ?)
        RETURNING id, message, received_at`,
      args: [now + leaseMs, now, limit],
    });
    return result.rows.map((row) => ({
      id: String(row.id),
      message: String(row.message),
      receivedAt: String(row.received_at),
    }));
  }
  async acknowledgeFeedback(id: string) {
    await this.execute({ sql: "DELETE FROM feedback_outbox WHERE id=?", args: [id] });
  }
  async releaseFeedback(id: string, retryAt = Date.now() + 120_000) {
    await this.execute({
      sql: "UPDATE feedback_outbox SET lease_until=? WHERE id=?",
      args: [retryAt, id],
    });
  }
  async createChallenge(v: Challenge) {
    await this.execute({
      sql: `INSERT INTO auth_challenges (id,nonce,address,origin,network,message,expires_at,consumed_at) VALUES (?,?,?,?,?,?,?,?)`,
      args: [
        v.id,
        v.nonce,
        v.address,
        v.origin,
        v.network,
        v.message,
        v.expiresAt,
        v.consumedAt,
      ],
    });
  }
  async consumeChallenge(id: string, now: number) {
    const r = await this.execute({
      sql: `UPDATE auth_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND expires_at>? RETURNING *`,
      args: [now, id, now],
    });
    return r.rows[0] ? challengeFromRow(r.rows[0]) : null;
  }
  async pruneChallenges(now: number) {
    await this.execute({
      sql: `DELETE FROM auth_challenges WHERE consumed_at IS NOT NULL OR expires_at<=?`,
      args: [now],
    });
  }
  async savePreparedPayment(v: PreparedPaymentRecord) {
    await this.execute({
      sql: `INSERT INTO prepared_payments (id,transaction_json,fingerprint,amount_sompi,creator,post_id,buyer,expires_at) VALUES (?,?,?,?,?,?,?,?)`,
      args: [
        v.id,
        v.transaction,
        v.fingerprint,
        v.amountSompi,
        v.creator,
        v.postId,
        v.buyer,
        v.expiresAt,
      ],
    });
  }
  async getPreparedPayment(id: string, now: number) {
    const r = await this.execute({
      sql: `SELECT * FROM prepared_payments WHERE id=? AND expires_at>?`,
      args: [id, now],
    });
    return r.rows[0] ? preparedPaymentFromRow(r.rows[0]) : null;
  }
  async deletePreparedPayment(id: string) {
    await this.execute({ sql: `DELETE FROM prepared_payments WHERE id=?`, args: [id] });
  }
  async prunePreparedPayments(now: number) {
    await this.execute({
      sql: `DELETE FROM prepared_payments WHERE expires_at<=?`,
      args: [now],
    });
  }
  async savePaymentWorkflow(v: PaymentWorkflow) {
    await this.execute({
      sql: `INSERT INTO payment_workflows (prepared_payment_id,state,transaction_id,rejection,submitted_at) VALUES (?,?,?,?,?)
        ON CONFLICT(prepared_payment_id) DO UPDATE SET
          state=excluded.state,
          transaction_id=excluded.transaction_id,
          rejection=excluded.rejection,
          submitted_at=COALESCE(payment_workflows.submitted_at, excluded.submitted_at)`,
      args: [
        v.preparedPaymentId,
        v.state,
        v.transactionId,
        v.rejection,
        v.submittedAt ?? Date.now(),
      ],
    });
  }
  async getPaymentWorkflow(id: string) {
    const r = await this.execute({
      sql: `SELECT * FROM payment_workflows WHERE prepared_payment_id=?`,
      args: [id],
    });
    return r.rows[0] ? paymentWorkflowFromRow(r.rows[0]) : null;
  }
  async deletePaymentWorkflow(id: string) {
    await this.execute({
      sql: `DELETE FROM payment_workflows WHERE prepared_payment_id=?`,
      args: [id],
    });
  }
  async claimPaymentWorkflowTerminal(
    id: string,
    state: "CONFIRMED" | "REJECTED",
    now: number,
    rejection: string | null = null,
  ) {
    const r = await this.execute({
      sql: `UPDATE payment_workflows SET state=?, rejection=?, finalized_at=?
        WHERE prepared_payment_id=? AND finalized_at IS NULL
        RETURNING finalized_at`,
      args: [state, rejection, now, id],
    });
    return r.rows[0] ? number(r.rows[0].finalized_at) : null;
  }
  async pendingPaymentWorkflows(limit: number) {
    const r = await this.execute({
      sql: `SELECT * FROM payment_workflows WHERE state='SUBMITTED' ORDER BY prepared_payment_id LIMIT ?`,
      args: [limit],
    });
    return r.rows.map(paymentWorkflowFromRow);
  }
  async savePreparedMembership(v: PreparedMembershipRecord) {
    await this.execute({
      sql: `INSERT INTO prepared_memberships (id,transaction_json,fingerprint,covenant_id,sign_inputs,member_output_index,creator,buyer,kind,expires_at,price_sompi,version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        v.id,
        v.transaction,
        v.fingerprint,
        v.covenantId,
        JSON.stringify(v.signInputs),
        v.memberOutputIndex,
        v.creator,
        v.buyer,
        v.kind,
        v.expiresAt,
        v.priceSompi ?? null,
        1,
      ],
    });
  }
  async getPreparedMembership(id: string, now: number) {
    const r = await this.execute({
      sql: `SELECT * FROM prepared_memberships WHERE id=? AND expires_at>?`,
      args: [id, now],
    });
    return r.rows[0] ? preparedMembershipFromRow(r.rows[0]) : null;
  }
  async deletePreparedMembership(id: string) {
    await this.execute({
      sql: `DELETE FROM prepared_memberships WHERE id=?`,
      args: [id],
    });
  }
  async prunePreparedMemberships(now: number) {
    await this.execute({
      sql: `DELETE FROM prepared_memberships WHERE expires_at<=?`,
      args: [now],
    });
  }
  async saveMembershipWorkflow(v: MembershipWorkflow) {
    await this.execute({
      sql: `INSERT INTO membership_workflows (prepared_membership_id,state,transaction_id,rejection,submitted_at) VALUES (?,?,?,?,?)
        ON CONFLICT(prepared_membership_id) DO UPDATE SET
          state=excluded.state,
          transaction_id=excluded.transaction_id,
          rejection=excluded.rejection,
          submitted_at=COALESCE(membership_workflows.submitted_at, excluded.submitted_at)`,
      args: [
        v.preparedMembershipId,
        v.state,
        v.transactionId,
        v.rejection,
        v.submittedAt ?? Date.now(),
      ],
    });
  }
  async getMembershipWorkflow(id: string) {
    const r = await this.execute({
      sql: `SELECT * FROM membership_workflows WHERE prepared_membership_id=?`,
      args: [id],
    });
    return r.rows[0] ? membershipWorkflowFromRow(r.rows[0]) : null;
  }
  async deleteMembershipWorkflow(id: string) {
    await this.execute({
      sql: `DELETE FROM membership_workflows WHERE prepared_membership_id=?`,
      args: [id],
    });
  }
  async claimMembershipWorkflowTerminal(
    id: string,
    state: "CONFIRMED" | "REJECTED",
    now: number,
    rejection: string | null = null,
  ) {
    const r = await this.execute({
      sql: `UPDATE membership_workflows SET state=?, rejection=?, finalized_at=?
        WHERE prepared_membership_id=? AND finalized_at IS NULL
        RETURNING finalized_at`,
      args: [state, rejection, now, id],
    });
    return r.rows[0] ? number(r.rows[0].finalized_at) : null;
  }
  async pendingMembershipWorkflows(limit: number) {
    const r = await this.execute({
      sql: `SELECT * FROM membership_workflows WHERE state='SUBMITTED' ORDER BY prepared_membership_id LIMIT ?`,
      args: [limit],
    });
    return r.rows.map(membershipWorkflowFromRow);
  }
  async createSession(v: Session) {
    await this.execute({
      sql: `INSERT INTO sessions VALUES (?,?,?)`,
      args: [v.id, v.address, v.expiresAt],
    });
  }
  async getSession(id: string, now: number) {
    const r = await this.execute({
      sql: `SELECT * FROM sessions WHERE id=? AND expires_at>?`,
      args: [id, now],
    });
    return r.rows[0]
      ? {
          id: text(r.rows[0].id),
          address: text(r.rows[0].address),
          expiresAt: number(r.rows[0].expires_at),
        }
      : null;
  }
  async rollSession(id: string, expiresAt: number) {
    await this.execute({
      sql: `UPDATE sessions SET expires_at=? WHERE id=?`,
      args: [expiresAt, id],
    });
  }
  async deleteSession(id: string) {
    await this.execute({ sql: `DELETE FROM sessions WHERE id=?`, args: [id] });
  }
  async pruneSessions(now: number) {
    await this.execute({
      sql: `DELETE FROM sessions WHERE expires_at<=?`,
      args: [now],
    });
  }
  async getProfile(address: string) {
    const r = await this.execute({
      sql: `SELECT * FROM profiles WHERE address=?`,
      args: [address],
    });
    return r.rows[0] ? profileFromRow(r.rows[0]) : null;
  }
  async saveProfile(v: Profile) {
    await this.execute({
      sql: `INSERT INTO profiles (address,display_name,is_public,updated_at) VALUES (?,?,?,?) ON CONFLICT(address) DO UPDATE SET display_name=excluded.display_name,is_public=excluded.is_public,updated_at=excluded.updated_at`,
      args: [v.address, v.displayName, v.isPublic ? 1 : 0, v.updatedAt],
    });
  }
  async searchCreators(name: string, limit: number) {
    const r = await this.execute({
      sql: `SELECT p.* FROM profiles p WHERE p.display_name IS NOT NULL AND lower(p.display_name) LIKE lower(?) AND EXISTS (SELECT 1 FROM posts WHERE creator=p.address) ORDER BY p.display_name LIMIT ?`,
      args: [`%${name}%`, limit],
    });
    return r.rows.map(profileFromRow);
  }
  async publicCreators(limit: number) {
    const r = await this.execute({
      sql: `SELECT * FROM profiles WHERE is_public=1 AND EXISTS (SELECT 1 FROM posts WHERE creator=profiles.address) ORDER BY COALESCE(display_name,address) LIMIT ?`,
      args: [limit],
    });
    return r.rows.map(profileFromRow);
  }
  private async postRowByMedia(creator: string, digest: string) {
    const r = await this.execute({
      sql: `SELECT * FROM posts WHERE creator=? AND media_digest=?`,
      args: [creator, digest],
    });
    return r.rows[0];
  }
  async reservePublication(v: Post, expiresAt: number) {
    try {
      if (await this.postRowByMedia(v.creator, v.mediaDigest))
        return "DUPLICATE" as const;
      await this.execute({
        sql: `INSERT INTO pending_publications (post_id,creator,media_digest,media_key,expires_at) VALUES (?,?,?,?,?)`,
        args: [v.id, v.creator, v.mediaDigest, v.mediaKey, expiresAt],
      });
      return "RESERVED" as const;
    } catch (error) {
      if (isUniqueConstraint(error)) return "DUPLICATE" as const;
      throw error;
    }
  }
  async commitPublication(v: Post) {
    const transaction = await this.client.transaction("write");
    try {
      const pending = await transaction.execute({
        sql: `SELECT media_digest FROM pending_publications WHERE post_id=?`,
        args: [v.id],
      });
      if (!pending.rows[0] || text(pending.rows[0].media_digest) !== v.mediaDigest) {
        await transaction.rollback();
        await this.releasePublication(v.id).catch(() => undefined);
        return "DUPLICATE" as const;
      }
      await transaction.execute({
        sql: `INSERT INTO posts (id,creator,caption,price_sompi,media_type,media_size,media_digest,media_key,published_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        args: [
          v.id,
          v.creator,
          v.caption,
          v.priceSompi,
          v.mediaType,
          v.mediaSize,
          v.mediaDigest,
          v.mediaKey,
          v.publishedAt,
        ],
      });
      await transaction.execute({
        sql: `DELETE FROM pending_publications WHERE post_id=?`,
        args: [v.id],
      });
      await transaction.commit();
      return "COMMITTED" as const;
    } catch (error) {
      await transaction.rollback();
      await this.releasePublication(v.id).catch(() => undefined);
      if (isUniqueConstraint(error)) return "DUPLICATE" as const;
      throw error;
    }
  }
  async releasePublication(postId: string) {
    await this.execute({
      sql: `DELETE FROM pending_publications WHERE post_id=?`,
      args: [postId],
    });
  }
  async prunePendingPublications(now: number) {
    await this.execute({
      sql: `DELETE FROM pending_publications WHERE expires_at<=?`,
      args: [now],
    });
  }
  async publishPost(v: Post) {
    try {
      await this.execute({
        sql: `INSERT INTO posts (id,creator,caption,price_sompi,media_type,media_size,media_digest,media_key,published_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        args: [
          v.id,
          v.creator,
          v.caption,
          v.priceSompi,
          v.mediaType,
          v.mediaSize,
          v.mediaDigest,
          v.mediaKey,
          v.publishedAt,
        ],
      });
      return "COMMITTED" as const;
    } catch (error) {
      if (
        isUniqueConstraint(error) &&
        (await this.postRowByMedia(v.creator, v.mediaDigest))
      )
        return "MEDIA_DIGEST_CONFLICT" as const;
      throw error;
    }
  }
  async getPost(id: string) {
    const r = await this.execute({ sql: `SELECT * FROM posts WHERE id=?`, args: [id] });
    return r.rows[0] ? postFromRow(r.rows[0]) : null;
  }
  async findPostByMedia(creator: string, digest: string) {
    const row = await this.postRowByMedia(creator, digest);
    return row ? postFromRow(row) : null;
  }
  async creatorPosts(address: string) {
    const r = await this.execute({
      sql: `SELECT * FROM posts WHERE creator=? ORDER BY published_at DESC`,
      args: [address],
    });
    return r.rows.map(postFromRow);
  }
  async deletePost(id: string) {
    const transaction = await this.client.transaction("write");
    try {
      const found = await transaction.execute({
        sql: `SELECT * FROM posts WHERE id=?`,
        args: [id],
      });
      if (!found.rows[0]) {
        await transaction.rollback();
        return null;
      }
      const post = postFromRow(found.rows[0]);
      await transaction.execute({
        sql: `DELETE FROM purchases WHERE post_id=?`,
        args: [id],
      });
      await transaction.execute({ sql: `DELETE FROM posts WHERE id=?`, args: [id] });
      await transaction.commit();
      return post;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
  async createPurchase(v: Purchase): Promise<DuplicateOutcome> {
    try {
      await this.execute({
        sql: `INSERT INTO purchases (post_id,buyer,transaction_id) VALUES (?,?,?)`,
        args: [v.postId, v.buyer, v.transactionId],
      });
      return "CREATED";
    } catch (error) {
      if (isUniqueConstraint(error)) return "DUPLICATE";
      throw error;
    }
  }
  async getPurchase(postId: string, buyer: string) {
    const r = await this.execute({
      sql: `SELECT * FROM purchases WHERE post_id=? AND buyer=?`,
      args: [postId, buyer],
    });
    return r.rows[0] ? purchaseFromRow(r.rows[0]) : null;
  }
  async purchasesForBuyer(buyer: string) {
    const r = await this.execute({
      sql: `SELECT * FROM purchases WHERE buyer=?`,
      args: [buyer],
    });
    return r.rows.map(purchaseFromRow);
  }
  async getCreatorCovenant(creator: string) {
    const r = await this.execute({
      sql: `SELECT * FROM creator_covenants WHERE creator=? AND status<>'CANCELED'`,
      args: [creator],
    });
    return r.rows[0] ? creatorCovenantFromRow(r.rows[0]) : null;
  }
  async listCreatorCovenants(creator: string) {
    const r = await this.execute({
      sql: `SELECT * FROM creator_covenant_history WHERE creator=?`,
      args: [creator],
    });
    return r.rows.map(creatorCovenantFromRow);
  }
  async saveCreatorCovenant(v: CreatorCovenant): Promise<DuplicateOutcome> {
    try {
      await this.execute({
        sql: `INSERT INTO creator_covenants (creator,covenant_id,price_sompi,status) VALUES (?,?,?,'ACTIVE')`,
        args: [v.creator, v.covenantId, v.priceSompi],
      });
      return "CREATED";
    } catch (error) {
      if (isUniqueConstraint(error)) return "DUPLICATE";
      throw error;
    }
  }
  async createMembershipPurchase(v: MembershipPurchase): Promise<DuplicateOutcome> {
    try {
      await this.execute({
        sql: `INSERT INTO membership_purchases (transaction_id,buyer,creator,covenant_id) VALUES (?,?,?,?)`,
        args: [v.transactionId, v.buyer, v.creator, v.covenantId ?? null],
      });
      return "CREATED";
    } catch (error) {
      if (isUniqueConstraint(error)) return "DUPLICATE";
      throw error;
    }
  }
  async membershipReceipts(buyer: string, creator: string) {
    const r = await this.execute({
      sql: `SELECT * FROM membership_purchases WHERE buyer=? AND creator=?`,
      args: [buyer, creator],
    });
    return r.rows.map(membershipPurchaseFromRow);
  }
  async finalizePurchase(id: string, value: Purchase): Promise<DuplicateOutcome> {
    return this.transactionalFinalize(
      id,
      "prepared_payments",
      `INSERT INTO purchases (post_id,buyer,transaction_id) VALUES (?,?,?)`,
      [value.postId, value.buyer, value.transactionId],
    );
  }
  async finalizeOffer(id: string, value: CreatorCovenant): Promise<DuplicateOutcome> {
    const transaction = await this.client.transaction("write");
    try {
      const current = await transaction.execute({
        sql: `SELECT status FROM creator_covenants WHERE creator=?`,
        args: [value.creator],
      });
      if (current.rows[0] && current.rows[0].status !== "CANCELED") {
        await transaction.execute({
          sql: "DELETE FROM prepared_memberships WHERE id=?",
          args: [id],
        });
        await transaction.commit();
        return "DUPLICATE";
      }
      try {
        await transaction.execute({
          sql: `INSERT INTO creator_covenants (creator,covenant_id,price_sompi,status) VALUES (?,?,?,'ACTIVE') ON CONFLICT(creator) DO UPDATE SET covenant_id=excluded.covenant_id,price_sompi=excluded.price_sompi,status='ACTIVE'`,
          args: [value.creator, value.covenantId, value.priceSompi],
        });
        await transaction.execute({
          sql: `INSERT INTO creator_covenant_history (creator,covenant_id,price_sompi,status) VALUES (?,?,?,'ACTIVE')`,
          args: [value.creator, value.covenantId, value.priceSompi],
        });
      } catch (error) {
        if (!isUniqueConstraint(error)) throw error;
        await transaction.execute({
          sql: "DELETE FROM prepared_memberships WHERE id=?",
          args: [id],
        });
        await transaction.commit();
        return "DUPLICATE";
      }
      await transaction.execute({
        sql: "DELETE FROM prepared_memberships WHERE id=?",
        args: [id],
      });
      await transaction.commit();
      return "CREATED";
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
  async finalizePriceUpdate(
    id: string,
    value: CreatorCovenant,
  ): Promise<DuplicateOutcome> {
    const transaction = await this.client.transaction("write");
    try {
      const result = await transaction.execute({
        sql: `UPDATE creator_covenants SET price_sompi=?,status='ACTIVE' WHERE creator=? AND covenant_id=? AND status<>'CANCELED'`,
        args: [value.priceSompi, value.creator, value.covenantId],
      });
      if (result.rowsAffected !== 1) {
        await transaction.execute({
          sql: "DELETE FROM prepared_memberships WHERE id=?",
          args: [id],
        });
        await transaction.commit();
        return "DUPLICATE";
      }
      await transaction.execute({
        sql: `UPDATE creator_covenant_history SET price_sompi=?,status='ACTIVE' WHERE creator=? AND covenant_id=?`,
        args: [value.priceSompi, value.creator, value.covenantId],
      });
      await transaction.execute({
        sql: "DELETE FROM prepared_memberships WHERE id=?",
        args: [id],
      });
      await transaction.commit();
      return "CREATED";
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
  async finalizeCancellation(
    id: string,
    value: Pick<CreatorCovenant, "creator" | "covenantId">,
  ): Promise<DuplicateOutcome> {
    const transaction = await this.client.transaction("write");
    try {
      const result = await transaction.execute({
        sql: `UPDATE creator_covenants SET status='CANCELED' WHERE creator=? AND covenant_id=? AND status<>'CANCELED'`,
        args: [value.creator, value.covenantId],
      });
      if (result.rowsAffected !== 1) {
        await transaction.execute({
          sql: "DELETE FROM prepared_memberships WHERE id=?",
          args: [id],
        });
        await transaction.commit();
        return "DUPLICATE";
      }
      await transaction.execute({
        sql: `UPDATE creator_covenant_history SET status='CANCELED' WHERE creator=? AND covenant_id=?`,
        args: [value.creator, value.covenantId],
      });
      await transaction.execute({
        sql: "DELETE FROM prepared_memberships WHERE id=?",
        args: [id],
      });
      await transaction.commit();
      return "CREATED";
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
  async finalizeMembershipPurchase(
    id: string,
    value: MembershipPurchase,
  ): Promise<DuplicateOutcome> {
    return this.transactionalFinalize(
      id,
      "prepared_memberships",
      `INSERT INTO membership_purchases (transaction_id,buyer,creator,covenant_id) VALUES (?,?,?,?)`,
      [value.transactionId, value.buyer, value.creator, value.covenantId ?? null],
    );
  }
  private async transactionalFinalize(
    id: string,
    preparedTable: string,
    insertSql: string,
    insertArgs: (string | number | null)[],
  ): Promise<DuplicateOutcome> {
    const transaction = await this.client.transaction("write");
    try {
      let outcome: DuplicateOutcome = "CREATED";
      try {
        await transaction.execute({ sql: insertSql, args: insertArgs });
      } catch (error) {
        if (!isUniqueConstraint(error)) throw error;
        outcome = "DUPLICATE";
      }
      await transaction.execute({
        sql: `DELETE FROM ${preparedTable} WHERE id=?`,
        args: [id],
      });
      await transaction.commit();
      return outcome;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }
}
const text = (v: unknown) => {
  if (typeof v !== "string") throw new Error("INVALID_DATABASE_TEXT");
  return v;
};
const number = (v: unknown) => {
  if (typeof v !== "number" || !Number.isSafeInteger(v))
    throw new Error("INVALID_DATABASE_NUMBER");
  return v;
};
const challengeFromRow = (r: Record<string, unknown>): Challenge => ({
  id: text(r.id),
  nonce: text(r.nonce),
  address: text(r.address),
  origin: text(r.origin),
  network: text(r.network),
  message: text(r.message),
  expiresAt: number(r.expires_at),
  consumedAt: r.consumed_at === null ? null : number(r.consumed_at),
});
const profileFromRow = (r: Record<string, unknown>): Profile => ({
  address: text(r.address),
  displayName: r.display_name === null ? null : text(r.display_name),
  isPublic: Boolean(r.is_public),
  updatedAt: number(r.updated_at),
});
const postFromRow = (r: Record<string, unknown>): Post => ({
  id: text(r.id),
  creator: text(r.creator),
  caption: text(r.caption),
  priceSompi: text(r.price_sompi),
  mediaType: text(r.media_type) as Post["mediaType"],
  mediaSize: number(r.media_size),
  mediaDigest: text(r.media_digest),
  mediaKey: text(r.media_key),
  publishedAt: number(r.published_at),
});
const purchaseFromRow = (r: Record<string, unknown>): Purchase => ({
  postId: text(r.post_id),
  buyer: text(r.buyer),
  transactionId: text(r.transaction_id),
});
const nullableNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : number(value);
const paymentWorkflowFromRow = (r: Record<string, unknown>): PaymentWorkflow => ({
  preparedPaymentId: text(r.prepared_payment_id),
  state: paymentWorkflowState(text(r.state)),
  transactionId: text(r.transaction_id),
  rejection: r.rejection === null ? null : text(r.rejection),
  submittedAt: nullableNumber(r.submitted_at),
  finalizedAt: nullableNumber(r.finalized_at),
});
const membershipWorkflowFromRow = (r: Record<string, unknown>): MembershipWorkflow => ({
  preparedMembershipId: text(r.prepared_membership_id),
  state: membershipWorkflowState(text(r.state)),
  transactionId: text(r.transaction_id),
  rejection: r.rejection === null ? null : text(r.rejection),
  submittedAt: nullableNumber(r.submitted_at),
  finalizedAt: nullableNumber(r.finalized_at),
});
const creatorCovenantFromRow = (r: Record<string, unknown>): CreatorCovenant => ({
  creator: text(r.creator),
  covenantId: text(r.covenant_id),
  priceSompi: text(r.price_sompi),
  ...(r.status === "CANCELED" ? { status: "CANCELED" as const } : {}),
});
const membershipPurchaseFromRow = (r: Record<string, unknown>): MembershipPurchase => ({
  transactionId: text(r.transaction_id),
  buyer: text(r.buyer),
  creator: text(r.creator),
  covenantId:
    r.covenant_id === null || r.covenant_id === undefined
      ? undefined
      : text(r.covenant_id),
});
const preparedPaymentFromRow = (r: Record<string, unknown>): PreparedPaymentRecord => ({
  id: text(r.id),
  transaction: text(r.transaction_json),
  fingerprint: text(r.fingerprint),
  amountSompi: text(r.amount_sompi),
  creator: text(r.creator),
  postId: text(r.post_id),
  buyer: text(r.buyer),
  expiresAt: number(r.expires_at),
});
const preparedMembershipFromRow = (
  r: Record<string, unknown>,
): PreparedMembershipRecord => ({
  id: text(r.id),
  transaction: validatedJson(text(r.transaction_json)),
  fingerprint: text(r.fingerprint),
  covenantId: text(r.covenant_id),
  signInputs: signInputs(text(r.sign_inputs)),
  memberOutputIndex:
    r.member_output_index === null ? null : number(r.member_output_index),
  creator: text(r.creator),
  buyer: text(r.buyer),
  kind: membershipKind(text(r.kind)),
  expiresAt: number(r.expires_at),
  priceSompi: text(r.price_sompi),
});
const validatedJson = (value: string) => {
  try {
    JSON.parse(value);
    return value;
  } catch {
    throw new Error("INVALID_DATABASE_JSON");
  }
};
const signInputs = (value: string): number[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("INVALID_DATABASE_JSON");
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some((x) => typeof x !== "number" || !Number.isSafeInteger(x) || x < 0)
  )
    throw new Error("INVALID_SIGN_INPUTS");
  return parsed as number[];
};
const membershipKind = (value: string): PreparedMembershipRecord["kind"] => {
  if (
    value !== "offer" &&
    value !== "purchase" &&
    value !== "update" &&
    value !== "cancel"
  )
    throw new Error("INVALID_MEMBERSHIP_KIND");
  return value;
};
const paymentWorkflowState = (value: string): PaymentWorkflow["state"] => {
  if (value !== "SUBMITTED" && value !== "CONFIRMED" && value !== "REJECTED")
    throw new Error("INVALID_PAYMENT_WORKFLOW_STATE");
  return value;
};
const membershipWorkflowState = (value: string): MembershipWorkflow["state"] => {
  if (value !== "SUBMITTED" && value !== "CONFIRMED" && value !== "REJECTED")
    throw new Error("INVALID_MEMBERSHIP_WORKFLOW_STATE");
  return value;
};
const isUniqueConstraint = (error: unknown) =>
  error instanceof Error && /unique|constraint/i.test(error.message);
