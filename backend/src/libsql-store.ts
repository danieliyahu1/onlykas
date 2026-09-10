import { createClient, type Client } from "@libsql/client";
import type { Challenge, CreatorCovenant, MembershipPurchase, Post, PreparedMembershipRecord, PreparedPaymentRecord, Profile, Purchase, Session, Store } from "./domain.js";
import { logger as defaultLogger, type Logger } from "./observability.js";

export class LibsqlStore implements Store {
  private readonly client: Client;
  constructor(url: string, authToken?: string, private readonly logger: Logger = defaultLogger) { this.client = createClient({ url, ...(authToken ? { authToken } : {}) }); }
  async initialize() {
    await this.client.batch([
      `CREATE TABLE IF NOT EXISTS auth_challenges (id TEXT PRIMARY KEY, nonce TEXT NOT NULL UNIQUE, address TEXT NOT NULL, origin TEXT NOT NULL, network TEXT NOT NULL, message TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER)`,
      `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, address TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS profiles (address TEXT PRIMARY KEY, display_name TEXT, updated_at INTEGER NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, creator TEXT NOT NULL, caption TEXT NOT NULL, price_sompi TEXT NOT NULL, media_type TEXT NOT NULL, media_size INTEGER NOT NULL, media_digest TEXT NOT NULL UNIQUE, media_key TEXT NOT NULL, published_at INTEGER NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS posts_creator_date ON posts (creator, published_at DESC)`,
      `CREATE TABLE IF NOT EXISTS purchases (post_id TEXT NOT NULL, buyer TEXT NOT NULL, transaction_id TEXT NOT NULL UNIQUE, PRIMARY KEY (post_id, buyer))`,
      `CREATE INDEX IF NOT EXISTS purchases_buyer ON purchases (buyer)`,
      `CREATE TABLE IF NOT EXISTS creator_covenants (creator TEXT PRIMARY KEY, covenant_id TEXT NOT NULL UNIQUE)`,
      `CREATE TABLE IF NOT EXISTS membership_purchases (transaction_id TEXT PRIMARY KEY, buyer TEXT NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS membership_purchases_buyer ON membership_purchases (buyer)`,
      `CREATE TABLE IF NOT EXISTS prepared_payments (id TEXT PRIMARY KEY, transaction_json TEXT NOT NULL, fingerprint TEXT NOT NULL, amount_sompi TEXT NOT NULL, creator TEXT NOT NULL, post_id TEXT NOT NULL, buyer TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS prepared_memberships (id TEXT PRIMARY KEY, transaction_json TEXT NOT NULL, fingerprint TEXT NOT NULL, covenant_id TEXT NOT NULL, sign_inputs TEXT NOT NULL, member_output_index INTEGER, creator TEXT NOT NULL, buyer TEXT NOT NULL, kind TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
    ], "write");
    this.logger.info("database_initialized");
  }
  async createChallenge(v: Challenge) { await this.client.execute({ sql: `INSERT INTO auth_challenges VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, args: [v.id,v.nonce,v.address,v.origin,v.network,v.message,v.expiresAt,v.consumedAt] }); }
  async consumeChallenge(id: string, now: number) { const r = await this.client.execute({sql:`UPDATE auth_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND expires_at>? RETURNING *`,args:[now,id,now]}); return r.rows[0] ? challengeFromRow(r.rows[0]) : null; }
  async pruneChallenges(now: number) { await this.client.execute({sql:`DELETE FROM auth_challenges WHERE consumed_at IS NOT NULL OR expires_at<=?`,args:[now]}); }
  async savePreparedPayment(v: PreparedPaymentRecord) { await this.client.execute({sql:`INSERT INTO prepared_payments VALUES (?,?,?,?,?,?,?,?)`,args:[v.id,v.transaction,v.fingerprint,v.amountSompi,v.creator,v.postId,v.buyer,v.expiresAt]}); }
  async getPreparedPayment(id: string, now: number) { const r=await this.client.execute({sql:`SELECT * FROM prepared_payments WHERE id=? AND expires_at>?`,args:[id,now]}); return r.rows[0] ? preparedPaymentFromRow(r.rows[0]) : null; }
  async deletePreparedPayment(id: string) { await this.client.execute({sql:`DELETE FROM prepared_payments WHERE id=?`,args:[id]}); }
  async prunePreparedPayments(now: number) { await this.client.execute({sql:`DELETE FROM prepared_payments WHERE expires_at<=?`,args:[now]}); }
  async savePreparedMembership(v: PreparedMembershipRecord) { await this.client.execute({sql:`INSERT INTO prepared_memberships VALUES (?,?,?,?,?,?,?,?,?,?)`,args:[v.id,v.transaction,v.fingerprint,v.covenantId,JSON.stringify(v.signInputs),v.memberOutputIndex,v.creator,v.buyer,v.kind,v.expiresAt]}); }
  async getPreparedMembership(id: string, now: number) { const r=await this.client.execute({sql:`SELECT * FROM prepared_memberships WHERE id=? AND expires_at>?`,args:[id,now]}); return r.rows[0] ? preparedMembershipFromRow(r.rows[0]) : null; }
  async deletePreparedMembership(id: string) { await this.client.execute({sql:`DELETE FROM prepared_memberships WHERE id=?`,args:[id]}); }
  async prunePreparedMemberships(now: number) { await this.client.execute({sql:`DELETE FROM prepared_memberships WHERE expires_at<=?`,args:[now]}); }
  async createSession(v: Session) { await this.client.execute({sql:`INSERT INTO sessions VALUES (?,?,?)`,args:[v.id,v.address,v.expiresAt]}); }
  async getSession(id: string, now: number) { const r=await this.client.execute({sql:`SELECT * FROM sessions WHERE id=? AND expires_at>?`,args:[id,now]}); return r.rows[0] ? {id:text(r.rows[0].id),address:text(r.rows[0].address),expiresAt:number(r.rows[0].expires_at)} : null; }
  async rollSession(id: string, expiresAt: number) { await this.client.execute({sql:`UPDATE sessions SET expires_at=? WHERE id=?`,args:[expiresAt,id]}); }
  async deleteSession(id: string) { await this.client.execute({sql:`DELETE FROM sessions WHERE id=?`,args:[id]}); }
  async getProfile(address: string) { const r=await this.client.execute({sql:`SELECT * FROM profiles WHERE address=?`,args:[address]}); return r.rows[0] ? profileFromRow(r.rows[0]) : null; }
  async saveProfile(v: Profile) { await this.client.execute({sql:`INSERT INTO profiles VALUES (?,?,?) ON CONFLICT(address) DO UPDATE SET display_name=excluded.display_name,updated_at=excluded.updated_at`,args:[v.address,v.displayName,v.updatedAt]}); }
  async searchCreators(name: string, limit: number) { const r=await this.client.execute({sql:`SELECT p.* FROM profiles p WHERE p.display_name IS NOT NULL AND lower(p.display_name) LIKE lower(?) AND EXISTS (SELECT 1 FROM posts WHERE creator=p.address) ORDER BY p.display_name LIMIT ?`,args:[`%${name}%`,limit]}); return r.rows.map(profileFromRow); }
  async publishPost(v: Post) { try { await this.client.execute({sql:`INSERT INTO posts (id,creator,caption,price_sompi,media_type,media_size,media_digest,media_key,published_at) VALUES (?,?,?,?,?,?,?,?,?)`,args:[v.id,v.creator,v.caption,v.priceSompi,v.mediaType,v.mediaSize,v.mediaDigest,v.mediaKey,v.publishedAt]}); return "COMMITTED"; } catch (e) { const r=await this.client.execute({sql:`SELECT 1 FROM posts WHERE media_digest=?`,args:[v.mediaDigest]}); if (r.rows[0]) return "MEDIA_DIGEST_CONFLICT"; throw e; } }
  async getPost(id: string) { const r=await this.client.execute({sql:`SELECT * FROM posts WHERE id=?`,args:[id]}); return r.rows[0] ? postFromRow(r.rows[0]) : null; }
  async creatorPosts(address: string) { const r=await this.client.execute({sql:`SELECT * FROM posts WHERE creator=? ORDER BY published_at DESC`,args:[address]}); return r.rows.map(postFromRow); }
  async createPurchase(v: Purchase) { try { await this.client.execute({sql:`INSERT INTO purchases VALUES (?,?,?)`,args:[v.postId,v.buyer,v.transactionId]}); return true; } catch { return false; } }
  async getPurchase(postId: string, buyer: string) { const r=await this.client.execute({sql:`SELECT * FROM purchases WHERE post_id=? AND buyer=?`,args:[postId,buyer]}); return r.rows[0] ? purchaseFromRow(r.rows[0]) : null; }
  async purchasesForBuyer(buyer: string) { const r=await this.client.execute({sql:`SELECT * FROM purchases WHERE buyer=?`,args:[buyer]}); return r.rows.map(purchaseFromRow); }
  async getCreatorCovenant(creator: string) { const r=await this.client.execute({sql:`SELECT * FROM creator_covenants WHERE creator=?`,args:[creator]}); return r.rows[0] ? creatorCovenantFromRow(r.rows[0]) : null; }
  async saveCreatorCovenant(v: CreatorCovenant) { await this.client.execute({sql:`INSERT INTO creator_covenants VALUES (?,?)`,args:[v.creator,v.covenantId]}); }
  async createMembershipPurchase(v: MembershipPurchase) { try { await this.client.execute({sql:`INSERT INTO membership_purchases (transaction_id,buyer) VALUES (?,?)`,args:[v.transactionId,v.buyer]}); return true; } catch { return false; } }
  async membershipPurchases(buyer: string) { const r=await this.client.execute({sql:`SELECT * FROM membership_purchases WHERE buyer=?`,args:[buyer]}); return r.rows.map(membershipPurchaseFromRow); }
}
const text=(v:unknown)=>{if(typeof v!=="string")throw new Error("Invalid database text");return v;}; const number=(v:unknown)=>Number(v);
const challengeFromRow=(r:Record<string,unknown>):Challenge=>({id:text(r.id),nonce:text(r.nonce),address:text(r.address),origin:text(r.origin),network:text(r.network),message:text(r.message),expiresAt:number(r.expires_at),consumedAt:r.consumed_at===null?null:number(r.consumed_at)});
const profileFromRow=(r:Record<string,unknown>):Profile=>({address:text(r.address),displayName:r.display_name===null?null:text(r.display_name),updatedAt:number(r.updated_at)});
const postFromRow=(r:Record<string,unknown>):Post=>({id:text(r.id),creator:text(r.creator),caption:text(r.caption),priceSompi:text(r.price_sompi),mediaType:text(r.media_type) as Post["mediaType"],mediaSize:number(r.media_size),mediaDigest:text(r.media_digest),mediaKey:text(r.media_key),publishedAt:number(r.published_at)});
const purchaseFromRow=(r:Record<string,unknown>):Purchase=>({postId:text(r.post_id),buyer:text(r.buyer),transactionId:text(r.transaction_id)});
const creatorCovenantFromRow=(r:Record<string,unknown>):CreatorCovenant=>({creator:text(r.creator),covenantId:text(r.covenant_id)});
const membershipPurchaseFromRow=(r:Record<string,unknown>):MembershipPurchase=>({transactionId:text(r.transaction_id),buyer:text(r.buyer)});
const preparedPaymentFromRow=(r:Record<string,unknown>):PreparedPaymentRecord=>({id:text(r.id),transaction:text(r.transaction_json),fingerprint:text(r.fingerprint),amountSompi:text(r.amount_sompi),creator:text(r.creator),postId:text(r.post_id),buyer:text(r.buyer),expiresAt:number(r.expires_at)});
const preparedMembershipFromRow=(r:Record<string,unknown>):PreparedMembershipRecord=>({id:text(r.id),transaction:text(r.transaction_json),fingerprint:text(r.fingerprint),covenantId:text(r.covenant_id),signInputs:JSON.parse(text(r.sign_inputs)) as number[],memberOutputIndex:r.member_output_index===null?null:number(r.member_output_index),creator:text(r.creator),buyer:text(r.buyer),kind:text(r.kind) as PreparedMembershipRecord["kind"],expiresAt:number(r.expires_at)});
