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

export class MemoryStore implements Store {
  readonly challenges = new Map<string, Challenge>();
  readonly sessions = new Map<string, Session>();
  readonly uploads = new Map<string, Upload>();
  readonly posts = new Map<string, Post>();
  readonly paymentAttempts = new Map<string, PaymentAttempt>();
  readonly purchases = new Map<string, Purchase>();
  readonly profiles = new Map<string, Profile>();

  async initialize(): Promise<void> {}
  async createChallenge(challenge: Challenge): Promise<void> {
    this.challenges.set(challenge.id, structuredClone(challenge));
  }
  async consumeChallenge(id: string, now: number): Promise<Challenge | null> {
    const challenge = this.challenges.get(id);
    if (
      !challenge ||
      challenge.consumedAt !== null ||
      challenge.expiresAt <= now
    )
      return null;
    challenge.consumedAt = now;
    return structuredClone(challenge);
  }
  async createSession(session: Session): Promise<void> {
    this.sessions.set(session.id, structuredClone(session));
  }
  async getSession(id: string, now: number): Promise<Session | null> {
    const session = this.sessions.get(id);
    return session && session.expiresAt > now ? structuredClone(session) : null;
  }
  async rollSession(id: string, expiresAt: number): Promise<void> {
    const session = this.sessions.get(id);
    if (session) session.expiresAt = expiresAt;
  }
  async deleteSession(id: string): Promise<void> {
    this.sessions.delete(id);
  }
  async getProfile(address: string): Promise<Profile | null> {
    const profile = this.profiles.get(address);
    return profile ? structuredClone(profile) : null;
  }
  async saveProfile(profile: Profile): Promise<void> {
    this.profiles.set(profile.address, structuredClone(profile));
  }
  async searchCreators(name: string, limit: number): Promise<Profile[]> {
    const wanted = name.toLocaleLowerCase();
    return [...this.profiles.values()]
      .filter((profile) =>
        profile.displayName?.toLocaleLowerCase().includes(wanted),
      )
      .filter((profile) =>
        [...this.posts.values()].some(
          (post) => post.creator === profile.address,
        ),
      )
      .slice(0, limit)
      .map((profile) => structuredClone(profile));
  }
  async createUpload(upload: Upload): Promise<void> {
    this.uploads.set(upload.id, structuredClone(upload));
  }
  async getUpload(id: string): Promise<Upload | null> {
    const upload = this.uploads.get(id);
    return upload ? structuredClone(upload) : null;
  }
  async updateUpload(upload: Upload): Promise<void> {
    this.uploads.set(upload.id, structuredClone(upload));
  }
  async claimUpload(now: number, staleBefore: number): Promise<Upload | null> {
    const upload = [...this.uploads.values()].find(
      (candidate) =>
        candidate.state === "UPLOADED" ||
        (candidate.state === "VERIFYING" && candidate.updatedAt < staleBefore),
    );
    if (!upload) return null;
    upload.state = "VERIFYING";
    upload.updatedAt = now;
    return structuredClone(upload);
  }
  async expiredUploads(now: number): Promise<Upload[]> {
    return [...this.uploads.values()]
      .filter(
        (upload) =>
          upload.expiresAt <= now &&
          upload.state !== "PUBLISHED" &&
          upload.state !== "EXPIRED",
      )
      .map((upload) => structuredClone(upload));
  }
  async commitPublication(
    uploadId: string,
    creator: string,
    post: Post,
  ): Promise<"COMMITTED" | "MEDIA_DIGEST_CONFLICT" | "UPLOAD_STATE_CONFLICT"> {
    const upload = this.uploads.get(uploadId);
    if (
      [...this.posts.values()].some(
        (item) => item.mediaDigest === post.mediaDigest,
      )
    )
      return "MEDIA_DIGEST_CONFLICT";
    if (
      !upload ||
      upload.creator !== creator ||
      upload.state !== "VERIFIED" ||
      this.posts.has(post.id)
    )
      return "UPLOAD_STATE_CONFLICT";
    this.posts.set(post.id, structuredClone(post));
    upload.state = "PUBLISHED";
    return "COMMITTED";
  }
  async getPost(id: string): Promise<Post | null> {
    const post = this.posts.get(id);
    return post ? structuredClone(post) : null;
  }
  async creatorPosts(address: string): Promise<Post[]> {
    return [...this.posts.values()]
      .filter((post) => post.creator === address)
      .sort((a, b) => b.publishedAt - a.publishedAt)
      .map((post) => structuredClone(post));
  }
  async createPaymentAttempt(attempt: PaymentAttempt): Promise<void> {
    this.paymentAttempts.set(attempt.id, structuredClone(attempt));
  }
  async getPaymentAttempt(id: string): Promise<PaymentAttempt | null> {
    const value = this.paymentAttempts.get(id);
    return value ? structuredClone(value) : null;
  }
  async unresolvedPaymentAttempt(
    postId: string,
    buyer: string,
  ): Promise<PaymentAttempt | null> {
    const value = [...this.paymentAttempts.values()].find(
      (attempt) =>
        attempt.postId === postId &&
        attempt.buyer === buyer &&
        (attempt.state === "PREPARED" || attempt.state === "PENDING"),
    );
    return value ? structuredClone(value) : null;
  }
  async pendingPaymentAttempts(): Promise<PaymentAttempt[]> {
    return [...this.paymentAttempts.values()]
      .filter((attempt) => attempt.state === "PENDING")
      .map((attempt) => structuredClone(attempt));
  }
  async compareAndSetPaymentAttempt(
    id: string,
    expectedState: PaymentAttemptState,
    update: PaymentAttemptUpdate,
  ): Promise<PaymentAttempt | null> {
    const current = this.paymentAttempts.get(id);
    if (!current || current.state !== expectedState) return null;
    const updated = { ...current, ...update };
    this.paymentAttempts.set(id, structuredClone(updated));
    return structuredClone(updated);
  }
  async confirmPaymentAttempt(
    id: string,
    expectedState: PaymentAttemptState,
    purchase: Purchase,
  ): Promise<PaymentAttempt | null> {
    const attempt = this.paymentAttempts.get(id);
    if (!attempt || attempt.state !== expectedState) return null;
    if (attempt.postId !== purchase.postId || attempt.buyer !== purchase.buyer)
      return null;
    if (
      this.purchases.has(`${purchase.postId}:${purchase.buyer}`) ||
      [...this.purchases.values()].some(
        (item) => item.transactionId === purchase.transactionId,
      )
    )
      return null;
    this.purchases.set(
      `${purchase.postId}:${purchase.buyer}`,
      structuredClone(purchase),
    );
    const confirmed = {
      ...attempt,
      signedTransactionId: purchase.transactionId,
      submittedAt: attempt.submittedAt ?? purchase.confirmedAt,
      lastCheckedAt:
        expectedState === "PENDING"
          ? purchase.confirmedAt
          : attempt.lastCheckedAt,
      reconciliationAttempts:
        attempt.reconciliationAttempts + (expectedState === "PENDING" ? 1 : 0),
      state: "CONFIRMED" as const,
    };
    this.paymentAttempts.set(id, structuredClone(confirmed));
    return structuredClone(confirmed);
  }
  async createPurchase(purchase: Purchase): Promise<boolean> {
    const key = `${purchase.postId}:${purchase.buyer}`;
    if (
      [...this.purchases.values()].some(
        (item) => item.transactionId === purchase.transactionId,
      ) ||
      this.purchases.has(key)
    )
      return false;
    this.purchases.set(key, structuredClone(purchase));
    return true;
  }
  async hasPurchase(postId: string, buyer: string): Promise<boolean> {
    return this.purchases.has(`${postId}:${buyer}`);
  }
}
