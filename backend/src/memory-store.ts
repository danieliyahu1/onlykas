import type { Challenge, CreatorCovenant, MembershipPurchase, Post, Profile, Purchase, Session, Store } from "./domain.js";

export class MemoryStore implements Store {
  readonly challenges = new Map<string, Challenge>(); readonly sessions = new Map<string, Session>();
  readonly profiles = new Map<string, Profile>(); readonly posts = new Map<string, Post>();
  readonly purchases = new Map<string, Purchase>();
  readonly creatorCovenants = new Map<string, CreatorCovenant>();
  readonly membershipPurchaseRecords = new Map<string, MembershipPurchase>();
  async initialize() {}
  async createChallenge(v: Challenge) { this.challenges.set(v.id, structuredClone(v)); }
  async consumeChallenge(id: string, now: number) { const v = this.challenges.get(id); if (!v || v.consumedAt !== null || v.expiresAt <= now) return null; v.consumedAt = now; return structuredClone(v); }
  async createSession(v: Session) { this.sessions.set(v.id, structuredClone(v)); }
  async getSession(id: string, now: number) { const v = this.sessions.get(id); return v && v.expiresAt > now ? structuredClone(v) : null; }
  async rollSession(id: string, expiresAt: number) { const v = this.sessions.get(id); if (v) v.expiresAt = expiresAt; }
  async deleteSession(id: string) { this.sessions.delete(id); }
  async getProfile(address: string) { const v = this.profiles.get(address); return v ? structuredClone(v) : null; }
  async saveProfile(v: Profile) { this.profiles.set(v.address, structuredClone(v)); }
  async searchCreators(name: string, limit: number) { const q = name.toLocaleLowerCase(); return [...this.profiles.values()].filter(v => v.displayName?.toLocaleLowerCase().includes(q)).filter(v => [...this.posts.values()].some(p => p.creator === v.address)).slice(0, limit).map(v => structuredClone(v)); }
  async publishPost(v: Post) { if ([...this.posts.values()].some(p => p.mediaDigest === v.mediaDigest)) return "MEDIA_DIGEST_CONFLICT"; this.posts.set(v.id, structuredClone(v)); return "COMMITTED"; }
  async getPost(id: string) { const v = this.posts.get(id); return v ? structuredClone(v) : null; }
  async creatorPosts(address: string) { return [...this.posts.values()].filter(v => v.creator === address).sort((a,b) => b.publishedAt-a.publishedAt).map(v => structuredClone(v)); }
  async createPurchase(v: Purchase) { const duplicate = [...this.purchases.values()].some(x => x.transactionId === v.transactionId); if (duplicate || this.purchases.has(`${v.postId}:${v.buyer}`)) return false; this.purchases.set(`${v.postId}:${v.buyer}`, structuredClone(v)); return true; }
  async getPurchase(postId: string, buyer: string) { const v = this.purchases.get(`${postId}:${buyer}`); return v ? structuredClone(v) : null; }
  async getCreatorCovenant(creator: string) { const v = this.creatorCovenants.get(creator); return v ? structuredClone(v) : null; }
  async saveCreatorCovenant(v: CreatorCovenant) { if (this.creatorCovenants.has(v.creator)) throw new Error("COVENANT_ALREADY_REGISTERED"); this.creatorCovenants.set(v.creator, structuredClone(v)); }
  async createMembershipPurchase(v: MembershipPurchase) { if (this.membershipPurchaseRecords.has(v.transactionId)) return false; this.membershipPurchaseRecords.set(v.transactionId, structuredClone(v)); return true; }
  async membershipPurchases(buyer: string) { return [...this.membershipPurchaseRecords.values()].filter(v=>v.buyer===buyer).map(v=>structuredClone(v)); }
}
