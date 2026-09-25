import { MemoryStore } from "../memory-store.js";
import type { Profile } from "../domain/models.js";
import {
  createDiscoveryUseCases,
  createProfileUseCases,
  createSessionUseCases,
} from "./auth-use-cases.js";
import type { ProfileRepository } from "./ports.js";

const address = "kaspatest:creator";

function sessionUseCases(store: MemoryStore, verify: () => Promise<boolean>) {
  let id = 0;
  return createSessionUseCases({
    challenges: store,
    sessions: store,
    walletVerifier: { verify },
    now: () => 1_000,
    createId: () => `id-${++id}`,
    createNonce: () => `nonce-${++id}`,
    challengeTtlMs: 120,
    sessionIdleTtlMs: 900,
  });
}

describe("session use cases", () => {
  it("creates a challenge and consumes it exactly once after wallet verification", async () => {
    const store = new MemoryStore();
    const useCases = sessionUseCases(store, async () => true);
    const issued = await useCases.issueChallenge({
      address,
      origin: "https://kaskama.test",
      network: "kaspa_testnet_10",
      prompt: "Connect",
    });

    expect(issued.challenge.message).toContain(`Nonce: ${issued.challenge.nonce}`);
    const result = await useCases.authenticate({
      challengeId: issued.challenge.id,
      address,
      publicKey: "public-key",
      signature: "signature",
      origin: "https://kaskama.test",
      network: "kaspa_testnet_10",
    });

    expect(result).toMatchObject({ kind: "CREATED", session: { address } });
    expect(
      await useCases.authenticate({
        challengeId: issued.challenge.id,
        address,
        publicKey: "public-key",
        signature: "signature",
        origin: "https://kaskama.test",
        network: "kaspa_testnet_10",
      }),
    ).toEqual({ kind: "VERIFICATION_FAILED" });
  });

  it("does not create a session for an invalid wallet or expired challenge", async () => {
    const invalidStore = new MemoryStore();
    const invalid = sessionUseCases(invalidStore, async () => false);
    const invalidChallenge = await invalid.issueChallenge({
      address,
      origin: "origin",
      network: "network",
      prompt: "Connect",
    });
    expect(
      await invalid.authenticate({
        challengeId: invalidChallenge.challenge.id,
        address,
        publicKey: "key",
        signature: "signature",
        origin: "origin",
        network: "network",
      }),
    ).toEqual({ kind: "VERIFICATION_FAILED" });
    expect(invalidStore.sessions.size).toBe(0);

    const expiredStore = new MemoryStore();
    const expired = sessionUseCases(expiredStore, async () => true);
    const challenge = await expired.issueChallenge({
      address,
      origin: "origin",
      network: "network",
      prompt: "Connect",
    });
    challengeStore(expiredStore, challenge.challenge.id).expiresAt = 999;
    expect(
      await expired.authenticate({
        challengeId: challenge.challenge.id,
        address,
        publicKey: "key",
        signature: "signature",
        origin: "origin",
        network: "network",
      }),
    ).toEqual({ kind: "VERIFICATION_FAILED" });
    expect(expiredStore.sessions.size).toBe(0);
  });
});

describe("profile and discovery use cases", () => {
  const profileDependencies = (store: ProfileRepository) =>
    createProfileUseCases({
      profiles: store,
      normalizeDisplayName: (value) => value.trim().replace(/\s+/g, " "),
      validateDisplayName: (value) =>
        [...value].length > 40 ? "Names can be up to 40 characters." : null,
    });

  it("rejects invalid names without persisting and preserves omitted fields", async () => {
    const store = new MemoryStore();
    const useCases = profileDependencies(store);
    await store.saveProfile({
      address,
      displayName: "Maya",
      isPublic: true,
      updatedAt: 1,
    });

    expect(
      await useCases.update({
        address,
        displayName: "x".repeat(41),
        now: 2,
      }),
    ).toEqual({ kind: "INVALID_DISPLAY_NAME" });
    expect(await store.getProfile(address)).toMatchObject({
      displayName: "Maya",
      isPublic: true,
      updatedAt: 1,
    });

    expect(await useCases.update({ address, isPublic: false, now: 3 })).toEqual({
      kind: "UPDATED",
      profile: { address, displayName: "Maya", isPublic: false, updatedAt: 3 },
    });
  });

  it("propagates profile repository failures and delegates discovery limits", async () => {
    const profile: Profile = {
      address,
      displayName: "Maya",
      isPublic: true,
      updatedAt: 1,
    };
    const profiles = {
      getProfile: async () => {
        throw new Error("database unavailable");
      },
      saveProfile: async () => undefined,
      searchCreators: async (name: string, limit: number) => [
        { ...profile, displayName: `${name}:${limit}` },
      ],
      publicCreators: async (limit: number) => [{ ...profile, updatedAt: limit }],
    };
    const useCases = profileDependencies(profiles);
    await expect(useCases.get(address)).rejects.toThrow("database unavailable");

    const discovery = createDiscoveryUseCases({ profiles });
    await expect(discovery.search("may", 20)).resolves.toEqual([
      { ...profile, displayName: "may:20" },
    ]);
    await expect(discovery.publicCreators(100)).resolves.toEqual([
      { ...profile, updatedAt: 100 },
    ]);
  });
});

function challengeStore(store: MemoryStore, id: string) {
  const challenge = store.challenges.get(id);
  if (!challenge) throw new Error("challenge missing");
  return challenge;
}
