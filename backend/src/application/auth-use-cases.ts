import type { Challenge, Profile, Session } from "../domain/models.js";
import type {
  ChallengeRepository,
  ProfileRepository,
  SessionRepository,
  WalletVerifier,
} from "./ports.js";

export interface IssueChallengeInput {
  address: string;
  origin: string;
  network: string;
  prompt: string;
}

export interface IssuedChallenge {
  challenge: Challenge;
  expiresAt: number;
}

export interface AuthenticateInput {
  challengeId: string;
  address: string;
  publicKey: string;
  signature: string;
  origin: string;
  network: string;
}

export type AuthenticateResult =
  { kind: "VERIFICATION_FAILED" } | { kind: "CREATED"; session: Session };

export interface SessionUseCases {
  issueChallenge(input: IssueChallengeInput): Promise<IssuedChallenge>;
  pruneChallenges(now: number): Promise<void>;
  authenticate(input: AuthenticateInput): Promise<AuthenticateResult>;
  pruneSessions(now: number): Promise<void>;
  getSession(id: string, now: number): Promise<Session | null>;
  refreshSession(id: string, now: number, expiresAt: number): Promise<Session | null>;
  logout(id: string): Promise<void>;
}

export function createSessionUseCases(dependencies: {
  challenges: ChallengeRepository;
  sessions: SessionRepository;
  walletVerifier: WalletVerifier;
  now: () => number;
  createId: () => string;
  createNonce: () => string;
  challengeTtlMs: number;
  sessionIdleTtlMs: number;
}): SessionUseCases {
  return {
    async issueChallenge(input) {
      const issuedAt = dependencies.now();
      const nonce = dependencies.createNonce();
      const challenge: Challenge = {
        id: dependencies.createId(),
        nonce,
        address: input.address,
        origin: input.origin,
        network: input.network,
        message: `${input.prompt}\n\nWallet: ${input.address}\nNetwork: ${input.network}\nOrigin: ${input.origin}\nNonce: ${nonce}`,
        expiresAt: issuedAt + dependencies.challengeTtlMs,
        consumedAt: null,
      };
      await dependencies.challenges.createChallenge(challenge);
      return { challenge, expiresAt: challenge.expiresAt };
    },

    pruneChallenges(now) {
      return dependencies.challenges.pruneChallenges(now);
    },

    async authenticate(input) {
      const challenge = await dependencies.challenges.consumeChallenge(
        input.challengeId,
        dependencies.now(),
      );
      if (
        !challenge ||
        challenge.address !== input.address ||
        challenge.origin !== input.origin ||
        challenge.network !== input.network ||
        !(await dependencies.walletVerifier.verify(
          challenge.message,
          input.signature,
          input.publicKey,
          input.address,
        ))
      ) {
        return { kind: "VERIFICATION_FAILED" };
      }
      const session: Session = {
        id: dependencies.createId(),
        address: input.address,
        expiresAt: dependencies.now() + dependencies.sessionIdleTtlMs,
      };
      await dependencies.sessions.createSession(session);
      return { kind: "CREATED", session };
    },

    pruneSessions(now) {
      return dependencies.sessions.pruneSessions(now);
    },

    getSession(id, now) {
      return dependencies.sessions.getSession(id, now);
    },

    async refreshSession(id, now, expiresAt) {
      const session = await dependencies.sessions.getSession(id, now);
      if (!session) return null;
      await dependencies.sessions.rollSession(id, expiresAt);
      return { ...session, expiresAt };
    },

    logout(id) {
      return dependencies.sessions.deleteSession(id);
    },
  };
}

export interface ProfileUpdateInput {
  address: string;
  displayName?: string;
  isPublic?: boolean;
  now: number;
}

export type ProfileUpdateResult =
  { kind: "INVALID_DISPLAY_NAME" } | { kind: "UPDATED"; profile: Profile };

export interface ProfileUseCases {
  get(address: string): Promise<Profile | null>;
  update(input: ProfileUpdateInput): Promise<ProfileUpdateResult>;
}

export function createProfileUseCases(dependencies: {
  profiles: ProfileRepository;
  normalizeDisplayName: (value: string) => string;
  validateDisplayName: (value: string) => string | null;
}): ProfileUseCases {
  return {
    get(address) {
      return dependencies.profiles.getProfile(address);
    },

    async update(input) {
      const existing = await dependencies.profiles.getProfile(input.address);
      const displayName =
        input.displayName === undefined
          ? (existing?.displayName ?? null)
          : dependencies.normalizeDisplayName(input.displayName);
      const validated = dependencies.validateDisplayName(displayName ?? "");
      if (
        input.displayName !== undefined &&
        validated !== null &&
        validated !== displayName
      ) {
        return { kind: "INVALID_DISPLAY_NAME" };
      }
      const profile: Profile = {
        address: input.address,
        displayName: displayName === "" ? null : displayName,
        isPublic: input.isPublic ?? existing?.isPublic ?? false,
        updatedAt: input.now,
      };
      await dependencies.profiles.saveProfile(profile);
      return { kind: "UPDATED", profile };
    },
  };
}

export interface DiscoveryUseCases {
  search(name: string, limit: number): Promise<Profile[]>;
  publicCreators(limit: number): Promise<Profile[]>;
}

export function createDiscoveryUseCases(dependencies: {
  profiles: ProfileRepository;
}): DiscoveryUseCases {
  return {
    search(name, limit) {
      return dependencies.profiles.searchCreators(name, limit);
    },
    publicCreators(limit) {
      return dependencies.profiles.publicCreators(limit);
    },
  };
}
