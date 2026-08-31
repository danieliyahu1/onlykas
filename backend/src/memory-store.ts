import type { Challenge, Post, Session, Store, Upload } from "./domain.js";

export class MemoryStore implements Store {
  readonly challenges = new Map<string, Challenge>();
  readonly sessions = new Map<string, Session>();
  readonly uploads = new Map<string, Upload>();
  readonly posts = new Map<string, Post>();

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
  async publish(uploadId: string, post: Post): Promise<boolean> {
    const upload = this.uploads.get(uploadId);
    if (
      !upload ||
      upload.state !== "VERIFIED" ||
      this.posts.has(post.id) ||
      [...this.posts.values()].some(
        (item) => item.mediaDigest === post.mediaDigest,
      )
    )
      return false;
    this.posts.set(post.id, structuredClone(post));
    upload.state = "PUBLISHED";
    return true;
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
}
