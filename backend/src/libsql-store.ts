import { createClient, type Client } from "@libsql/client";
import type { Challenge, CreatorCovenant, MembershipPurchase, Post, Profile, Purchase, Session, Store } from "./domain.js";

export class LibsqlStore implements Store {
  private readonly client: Client;
  constructor(url: string, authToken?: string) { this.client = createClient({ url, ...(authToken ? { authToken } : {}) }); }
  async initialize() {
    await this.client.batch([
      `CREATE TABLE IF NOT EXISTS auth_challenges (id TEXT PRIMARY KEY, nonce TEXT NOT NULL UNIQUE, address TEXT NOT NULL, origin TEXT NOT NULL, network TEXT NOT NULL, message TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER)`,
      `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, address TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS profiles (address TEXT PRIMARY KEY, display_name TEXT, updated_at INTEGER NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, creator TEXT NOT NULL, title TEXT NOT NULL, caption TEXT NOT NULL, price_sompi TEXT NOT NULL, media_type TEXT NOT NULL, media_size INTEGER NOT NULL, media_digest TEXT NOT NULL UNIQUE, media_key TEXT NOT NULL, published_at INTEGER NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS posts_creator_date ON posts (creator, published_at DESC)`,
      `CREATE TABLE IF NOT EXISTS purchases (post_id TEXT NOT NULL, buyer TEXT NOT NULL, transaction_id TEXT NOT NULL UNIQUE, PRIMARY KEY (post_id, buyer))`,
      `CREATE TABLE IF NOT EXISTS creator_covenants (creator TEXT PRIMARY KEY, covenant_id TEXT NOT NULL UNIQUE)`,
      `CREATE TABLE IF NOT EXISTS membership_purchases (transaction_id TEXT PRIMARY KEY, buyer TEXT NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS membership_purchases_buyer ON membership_purchases (buyer)`,
    ], "write");
  }
  async createChallenge(v: Challenge) { await this.client.execute({ sql: `INSERT INTO auth_challenges VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, args: [v.id,v.nonce,v.address,v.origin,v.network,v.message,v.expiresAt,v.consumedAt] }); }
  async consumeChallenge(id: string, now: number) { const r = await this.client.execute({sql:`UPDATE auth_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND expires_at>? RETURNING *`,args:[now,id,now]}); return r.rows[0] ? challengeFromRow(r.rows[0]) : null; }
  async createSession(v: Session) { await this.client.execute({sql:`INSERT INTO sessions VALUES (?,?,?)`,args:[v.id,v.address,v.expiresAt]}); }
  async getSession(id: string, now: number) { const r=await this.client.execute({sql:`SELECT * FROM sessions WHERE id=? AND expires_at>?`,args:[id,now]}); return r.rows[0] ? {id:text(r.rows[0].id),address:text(r.rows[0].address),expiresAt:number(r.rows[0].expires_at)} : null; }
  async rollSession(id: string, expiresAt: number) { await this.client.execute({sql:`UPDATE sessions SET expires_at=? WHERE id=?`,args:[expiresAt,id]}); }
  async deleteSession(id: string) { await this.client.execute({sql:`DELETE FROM sessions WHERE id=?`,args:[id]}); }
  async getProfile(address: string) { const r=await this.client.execute({sql:`SELECT * FROM profiles WHERE address=?`,args:[address]}); return r.rows[0] ? profileFromRow(r.rows[0]) : null; }
  async saveProfile(v: Profile) { await this.client.execute({sql:`INSERT INTO profiles VALUES (?,?,?) ON CONFLICT(address) DO UPDATE SET display_name=excluded.display_name,updated_at=excluded.updated_at`,args:[v.address,v.displayName,v.updatedAt]}); }
  async searchCreators(name: string, limit: number) { const r=await this.client.execute({sql:`SELECT p.* FROM profiles p WHERE p.display_name IS NOT NULL AND lower(p.display_name) LIKE lower(?) AND EXISTS (SELECT 1 FROM posts WHERE creator=p.address) ORDER BY p.display_name LIMIT ?`,args:[`%${name}%`,limit]}); return r.rows.map(profileFromRow); }
  async publishPost(v: Post) { try { await this.client.execute({sql:`INSERT INTO posts VALUES (?,?,?,?,?,?,?,?,?,?)`,args:[v.id,v.creator,v.title,v.caption,v.priceSompi,v.mediaType,v.mediaSize,v.mediaDigest,v.mediaKey,v.publishedAt]}); return "COMMITTED"; } catch (e) { const r=await this.client.execute({sql:`SELECT 1 FROM posts WHERE media_digest=?`,args:[v.mediaDigest]}); if (r.rows[0]) return "MEDIA_DIGEST_CONFLICT"; throw e; } }
  async getPost(id: string) { const r=await this.client.execute({sql:`SELECT * FROM posts WHERE id=?`,args:[id]}); return r.rows[0] ? postFromRow(r.rows[0]) : null; }
  async creatorPosts(address: string) { const r=await this.client.execute({sql:`SELECT * FROM posts WHERE creator=? ORDER BY published_at DESC`,args:[address]}); return r.rows.map(postFromRow); }
  async createPurchase(v: Purchase) { try { await this.client.execute({sql:`INSERT INTO purchases VALUES (?,?,?)`,args:[v.postId,v.buyer,v.transactionId]}); return true; } catch { return false; } }
  async getPurchase(postId: string, buyer: string) { const r=await this.client.execute({sql:`SELECT * FROM purchases WHERE post_id=? AND buyer=?`,args:[postId,buyer]}); return r.rows[0] ? purchaseFromRow(r.rows[0]) : null; }
  async getCreatorCovenant(creator: string) { const r=await this.client.execute({sql:`SELECT * FROM creator_covenants WHERE creator=?`,args:[creator]}); return r.rows[0] ? creatorCovenantFromRow(r.rows[0]) : null; }
  async saveCreatorCovenant(v: CreatorCovenant) { await this.client.execute({sql:`INSERT INTO creator_covenants VALUES (?,?)`,args:[v.creator,v.covenantId]}); }
  async createMembershipPurchase(v: MembershipPurchase) { try { await this.client.execute({sql:`INSERT INTO membership_purchases (transaction_id,buyer) VALUES (?,?)`,args:[v.transactionId,v.buyer]}); return true; } catch { return false; } }
  async membershipPurchases(buyer: string) { const r=await this.client.execute({sql:`SELECT * FROM membership_purchases WHERE buyer=?`,args:[buyer]}); return r.rows.map(membershipPurchaseFromRow); }
}
const text=(v:unknown)=>{if(typeof v!=="string")throw new Error("Invalid database text");return v;}; const number=(v:unknown)=>Number(v);
const challengeFromRow=(r:Record<string,unknown>):Challenge=>({id:text(r.id),nonce:text(r.nonce),address:text(r.address),origin:text(r.origin),network:text(r.network),message:text(r.message),expiresAt:number(r.expires_at),consumedAt:r.consumed_at===null?null:number(r.consumed_at)});
const profileFromRow=(r:Record<string,unknown>):Profile=>({address:text(r.address),displayName:r.display_name===null?null:text(r.display_name),updatedAt:number(r.updated_at)});
const postFromRow=(r:Record<string,unknown>):Post=>({id:text(r.id),creator:text(r.creator),title:text(r.title),caption:text(r.caption),priceSompi:text(r.price_sompi),mediaType:text(r.media_type) as Post["mediaType"],mediaSize:number(r.media_size),mediaDigest:text(r.media_digest),mediaKey:text(r.media_key),publishedAt:number(r.published_at)});
const purchaseFromRow=(r:Record<string,unknown>):Purchase=>({postId:text(r.post_id),buyer:text(r.buyer),transactionId:text(r.transaction_id)});
const creatorCovenantFromRow=(r:Record<string,unknown>):CreatorCovenant=>({creator:text(r.creator),covenantId:text(r.covenant_id)});
const membershipPurchaseFromRow=(r:Record<string,unknown>):MembershipPurchase=>({transactionId:text(r.transaction_id),buyer:text(r.buyer)});
