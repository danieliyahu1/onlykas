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

export class MemoryStore implements Repositories {
  readonly challenges = new Map<string, Challenge>();
  readonly sessions = new Map<string, Session>();
  readonly profiles = new Map<string, Profile>();
  readonly posts = new Map<string, Post>();
  readonly pendingPosts = new Map<string, { post: Post; expiresAt: number }>();
  readonly purchases = new Map<string, Purchase>();
  readonly creatorCovenants = new Map<string, CreatorCovenant>();
  readonly membershipPurchaseRecords = new Map<string, MembershipPurchase>();
  readonly preparedPaymentRecords = new Map<string, PreparedPaymentRecord>();
  readonly paymentWorkflows = new Map<string, PaymentWorkflow>();
  readonly membershipWorkflows = new Map<string, MembershipWorkflow>();
  readonly preparedMembershipRecords = new Map<string, PreparedMembershipRecord>();
  async initialize() {}
  async createChallenge(v: Challenge) {
    this.challenges.set(v.id, structuredClone(v));
  }
  async consumeChallenge(id: string, now: number) {
    const v = this.challenges.get(id);
    if (!v || v.consumedAt !== null || v.expiresAt <= now) return null;
    v.consumedAt = now;
    return structuredClone(v);
  }
  async pruneChallenges(now: number) {
    for (const [id, v] of this.challenges)
      if (v.consumedAt !== null || v.expiresAt <= now) this.challenges.delete(id);
  }
  async savePreparedPayment(v: PreparedPaymentRecord) {
    this.preparedPaymentRecords.set(v.id, structuredClone(v));
  }
  async getPreparedPayment(id: string, now: number) {
    const v = this.preparedPaymentRecords.get(id);
    return v && v.expiresAt > now ? structuredClone(v) : null;
  }
  async deletePreparedPayment(id: string) {
    this.preparedPaymentRecords.delete(id);
  }
  async prunePreparedPayments(now: number) {
    for (const [id, v] of this.preparedPaymentRecords)
      if (v.expiresAt <= now) this.preparedPaymentRecords.delete(id);
  }
  async savePaymentWorkflow(v: PaymentWorkflow) {
    this.paymentWorkflows.set(v.preparedPaymentId, structuredClone(v));
  }
  async getPaymentWorkflow(id: string) {
    const v = this.paymentWorkflows.get(id);
    return v ? structuredClone(v) : null;
  }
  async deletePaymentWorkflow(id: string) {
    this.paymentWorkflows.delete(id);
  }
  async saveMembershipWorkflow(v: MembershipWorkflow) {
    this.membershipWorkflows.set(v.preparedMembershipId, structuredClone(v));
  }
  async getMembershipWorkflow(id: string) {
    const v = this.membershipWorkflows.get(id);
    return v ? structuredClone(v) : null;
  }
  async deleteMembershipWorkflow(id: string) {
    this.membershipWorkflows.delete(id);
  }
  async savePreparedMembership(v: PreparedMembershipRecord) {
    this.preparedMembershipRecords.set(v.id, structuredClone(v));
  }
  async getPreparedMembership(id: string, now: number) {
    const v = this.preparedMembershipRecords.get(id);
    return v && v.expiresAt > now ? structuredClone(v) : null;
  }
  async deletePreparedMembership(id: string) {
    this.preparedMembershipRecords.delete(id);
  }
  async prunePreparedMemberships(now: number) {
    for (const [id, v] of this.preparedMembershipRecords)
      if (v.expiresAt <= now) this.preparedMembershipRecords.delete(id);
  }
  async createSession(v: Session) {
    this.sessions.set(v.id, structuredClone(v));
  }
  async getSession(id: string, now: number) {
    const v = this.sessions.get(id);
    return v && v.expiresAt > now ? structuredClone(v) : null;
  }
  async rollSession(id: string, expiresAt: number) {
    const v = this.sessions.get(id);
    if (v) v.expiresAt = expiresAt;
  }
  async deleteSession(id: string) {
    this.sessions.delete(id);
  }
  async pruneSessions(now: number) {
    for (const [id, v] of this.sessions)
      if (v.expiresAt <= now) this.sessions.delete(id);
  }
  async getProfile(address: string) {
    const v = this.profiles.get(address);
    return v ? structuredClone(v) : null;
  }
  async saveProfile(v: Profile) {
    this.profiles.set(v.address, structuredClone(v));
  }
  async searchCreators(name: string, limit: number) {
    const q = name.toLocaleLowerCase();
    return [...this.profiles.values()]
      .filter((v) => v.displayName?.toLocaleLowerCase().includes(q))
      .filter((v) => [...this.posts.values()].some((p) => p.creator === v.address))
      .slice(0, limit)
      .map((v) => structuredClone(v));
  }
  async publicCreators(limit: number) {
    return [...this.profiles.values()]
      .filter((v) => v.isPublic)
      .sort((a, b) =>
        (a.displayName ?? a.address).localeCompare(b.displayName ?? b.address),
      )
      .slice(0, limit)
      .map((v) => structuredClone(v));
  }
  async publishPost(v: Post) {
    if (
      [...this.posts.values()].some(
        (p) => p.creator === v.creator && p.mediaDigest === v.mediaDigest,
      )
    )
      return "MEDIA_DIGEST_CONFLICT" as const;
    this.posts.set(v.id, structuredClone(v));
    return "COMMITTED" as const;
  }
  async reservePublication(v: Post, expiresAt: number) {
    if (
      [
        ...this.posts.values(),
        ...[...this.pendingPosts.values()].map((x) => x.post),
      ].some(
        (post) => post.creator === v.creator && post.mediaDigest === v.mediaDigest,
      )
    )
      return "DUPLICATE" as const;
    this.pendingPosts.set(v.id, { post: structuredClone(v), expiresAt });
    return "RESERVED" as const;
  }
  async commitPublication(v: Post) {
    const pending = this.pendingPosts.get(v.id);
    if (!pending || pending.post.mediaDigest !== v.mediaDigest) {
      this.pendingPosts.delete(v.id);
      return "DUPLICATE" as const;
    }
    this.pendingPosts.delete(v.id);
    this.posts.set(v.id, structuredClone(v));
    return "COMMITTED" as const;
  }
  async releasePublication(postId: string) {
    this.pendingPosts.delete(postId);
  }
  async prunePendingPublications(now: number) {
    for (const [id, pending] of this.pendingPosts)
      if (pending.expiresAt <= now) this.pendingPosts.delete(id);
  }
  async getPost(id: string) {
    const v = this.posts.get(id);
    return v ? structuredClone(v) : null;
  }
  async findPostByMedia(creator: string, digest: string) {
    const v = [...this.posts.values()].find(
      (p) => p.creator === creator && p.mediaDigest === digest,
    );
    return v ? structuredClone(v) : null;
  }
  async creatorPosts(address: string) {
    return [...this.posts.values()]
      .filter((v) => v.creator === address)
      .sort((a, b) => b.publishedAt - a.publishedAt)
      .map((v) => structuredClone(v));
  }
  async deletePost(id: string) {
    const v = this.posts.get(id);
    if (!v) return null;
    this.posts.delete(id);
    for (const [key, value] of this.purchases)
      if (value.postId === id) this.purchases.delete(key);
    return structuredClone(v);
  }
  async createPurchase(v: Purchase): Promise<DuplicateOutcome> {
    const duplicate = [...this.purchases.values()].some(
      (x) => x.transactionId === v.transactionId,
    );
    if (duplicate || this.purchases.has(`${v.postId}:${v.buyer}`)) return "DUPLICATE";
    this.purchases.set(`${v.postId}:${v.buyer}`, structuredClone(v));
    return "CREATED";
  }
  async getPurchase(postId: string, buyer: string) {
    const v = this.purchases.get(`${postId}:${buyer}`);
    return v ? structuredClone(v) : null;
  }
  async purchasesForBuyer(buyer: string) {
    return [...this.purchases.values()]
      .filter((v) => v.buyer === buyer)
      .map((v) => structuredClone(v));
  }
  async getCreatorCovenant(creator: string) {
    const v = this.creatorCovenants.get(creator);
    return v ? structuredClone(v) : null;
  }
  async saveCreatorCovenant(v: CreatorCovenant): Promise<DuplicateOutcome> {
    if (
      this.creatorCovenants.has(v.creator) ||
      [...this.creatorCovenants.values()].some((x) => x.covenantId === v.covenantId)
    )
      return "DUPLICATE";
    this.creatorCovenants.set(v.creator, structuredClone(v));
    return "CREATED";
  }
  async createMembershipPurchase(v: MembershipPurchase): Promise<DuplicateOutcome> {
    if (this.membershipPurchaseRecords.has(v.transactionId)) return "DUPLICATE";
    this.membershipPurchaseRecords.set(v.transactionId, structuredClone(v));
    return "CREATED";
  }
  async membershipReceipts(buyer: string, creator: string) {
    return [...this.membershipPurchaseRecords.values()]
      .filter((v) => v.buyer === buyer && v.creator === creator)
      .map((v) => structuredClone(v));
  }
  async finalizePurchase(id: string, value: Purchase): Promise<DuplicateOutcome> {
    const outcome = await this.createPurchase(value);
    this.preparedPaymentRecords.delete(id);
    return outcome;
  }
  async finalizeOffer(id: string, value: CreatorCovenant): Promise<DuplicateOutcome> {
    const outcome = await this.saveCreatorCovenant(value);
    this.preparedMembershipRecords.delete(id);
    return outcome;
  }
  async finalizeMembershipPurchase(
    id: string,
    value: MembershipPurchase,
  ): Promise<DuplicateOutcome> {
    const outcome = await this.createMembershipPurchase(value);
    this.preparedMembershipRecords.delete(id);
    return outcome;
  }
}
