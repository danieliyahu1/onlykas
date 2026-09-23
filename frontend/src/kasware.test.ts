import { DEFAULT_NETWORK, networkDefinition } from "@onlykas/shared";
import { COPY } from "./copy.js";
import { isNetworkRequired } from "./errors.js";
import {
  NETWORK_SWITCH_REQUIRED_EVENT,
  NETWORK_SWITCHED_EVENT,
  SESSION_EXPIRED_EVENT,
  WalletNetworkError,
  api,
  authenticate,
  ensureWalletNetwork,
  signPreparedPayment,
  type Kasware,
} from "./kasware.js";

const walletNetwork = networkDefinition(DEFAULT_NETWORK).walletNetwork;
const address = `kaspatest:${"q".repeat(60)}`;

describe("Kasware authentication", () => {
  it("binds the backend challenge to the selected testnet account and public key", async () => {
    const wallet = {
      getAccounts: vi.fn(async () => [address]),
      requestAccounts: vi.fn(),
      getNetwork: vi.fn(async () => walletNetwork),
      switchNetwork: vi.fn(),
      getPublicKey: vi.fn(async () => "public-key"),
      signMessage: vi.fn(async () => "signature"),
      signPskt: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    window.kasware = wallet;
    const fetchMock = vi
      .spyOn(window, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            challengeId: "challenge",
            message: COPY.authPrompt,
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ address }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
    await expect(authenticate()).resolves.toBe(address);
    expect(wallet.signMessage).toHaveBeenCalledWith(COPY.authPrompt);
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({
      challengeId: "challenge",
      address,
      publicKey: "public-key",
      signature: "signature",
    });
    expect(wallet.requestAccounts).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("surfaces the underlying wallet error when signing a prepared transaction fails", async () => {
    window.kasware = {
      getAccounts: vi.fn(),
      requestAccounts: vi.fn(),
      getNetwork: vi.fn(async () => walletNetwork),
      switchNetwork: vi.fn(),
      getPublicKey: vi.fn(),
      signMessage: vi.fn(),
      signPskt: vi.fn(async () => {
        throw new Error("missing field `authorizingInput`");
      }),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    await expect(signPreparedPayment('{"inputs":[{}]}')).rejects.toMatchObject({
      message: `${COPY.transactionRejected} (missing field \`authorizingInput\`)`,
    });
  });

  it("uses exact cancellation copy and creates no backend challenge", async () => {
    window.kasware = {
      getAccounts: vi.fn(async () => []),
      requestAccounts: vi.fn(async () => {
        throw new Error("rejected");
      }),
      getNetwork: vi.fn(),
      switchNetwork: vi.fn(),
      getPublicKey: vi.fn(),
      signMessage: vi.fn(),
      signPskt: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const fetchMock = vi.spyOn(window, "fetch");
    await expect(authenticate()).rejects.toThrow(COPY.walletCancelled);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("uses the backend message instead of interpreting the error code", async () => {
    const fetchMock = vi.spyOn(window, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "AUTH_REQUIRED",
          message: "Please sign in first.",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const request = api("/api/profile");
    await expect(request).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      message: "Please sign in first.",
      status: 401,
    });
    fetchMock.mockRestore();
  });

  it("reports the server as down when the network request fails", async () => {
    const fetchMock = vi
      .spyOn(window, "fetch")
      .mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(api("/api/profile")).rejects.toMatchObject({
      code: "SERVER_UNAVAILABLE",
      message: COPY.serverDown,
      status: 0,
    });
    fetchMock.mockRestore();
  });

  it("announces an expired session when a protected request is unauthorized", async () => {
    const fetchMock = vi.spyOn(window, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "AUTHENTICATION_REQUIRED" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const listener = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, listener);

    await expect(api("/api/profile")).rejects.toMatchObject({ status: 401 });

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(SESSION_EXPIRED_EVENT, listener);
    fetchMock.mockRestore();
  });

  it("keeps the session check from announcing an expired session", async () => {
    const fetchMock = vi.spyOn(window, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "AUTH_REQUIRED" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const listener = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, listener);

    await expect(api("/api/auth/session")).rejects.toMatchObject({
      status: 401,
    });

    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(SESSION_EXPIRED_EVENT, listener);
    fetchMock.mockRestore();
  });
});

describe("wallet network reconciliation", () => {
  afterEach(() => {
    delete window.kasware;
    vi.useRealTimers();
  });

  it("skips the switcher when the wallet is already on the expected network", async () => {
    const wallet = {
      getNetwork: vi.fn(async () => walletNetwork),
      switchNetwork: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    window.kasware = wallet as unknown as Kasware;

    await expect(ensureWalletNetwork()).resolves.toBeUndefined();
    expect(wallet.switchNetwork).not.toHaveBeenCalled();
  });

  it("continues the action once the wallet switches to the expected network", async () => {
    let network = "kaspa_mainnet";
    const handlers: Record<string, () => void> = {};
    const wallet = {
      getNetwork: vi.fn(async () => network),
      switchNetwork: vi.fn(async () => {
        network = walletNetwork;
        handlers.networkChanged?.();
      }),
      on: vi.fn((event: string, handler: () => void) => {
        handlers[event] = handler;
      }),
      removeListener: vi.fn(),
    };
    window.kasware = wallet as unknown as Kasware;

    const required = vi.fn();
    const switched = vi.fn();
    window.addEventListener(NETWORK_SWITCH_REQUIRED_EVENT, required);
    window.addEventListener(NETWORK_SWITCHED_EVENT, switched);

    await expect(ensureWalletNetwork()).resolves.toBeUndefined();

    expect(required).toHaveBeenCalledTimes(1);
    expect(switched).toHaveBeenCalledTimes(1);
    expect((switched.mock.calls[0]![0] as CustomEvent<string>).detail).toBe(
      "Testnet 10",
    );
    expect(wallet.removeListener).toHaveBeenCalledWith(
      "networkChanged",
      expect.any(Function),
    );
    window.removeEventListener(NETWORK_SWITCH_REQUIRED_EVENT, required);
    window.removeEventListener(NETWORK_SWITCHED_EVENT, switched);
  });

  it("marks a rejected switch as a quiet network outcome, not a failure", async () => {
    const wallet = {
      getNetwork: vi.fn(async () => "kaspa_mainnet"),
      switchNetwork: vi.fn(async () => {
        throw new Error("dismissed");
      }),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    window.kasware = wallet as unknown as Kasware;

    const error = await ensureWalletNetwork().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WalletNetworkError);
    expect(isNetworkRequired(error)).toBe(true);
    expect((error as Error).message).toBe(COPY.wrongNetwork);
  });

  it("ends quietly when the network is not switched in time", async () => {
    vi.useFakeTimers();
    const wallet = {
      getNetwork: vi.fn(async () => "kaspa_mainnet"),
      switchNetwork: vi.fn(() => new Promise<void>(() => undefined)),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    window.kasware = wallet as unknown as Kasware;

    const pending = ensureWalletNetwork().catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(10_000);
    const error = await pending;
    expect(isNetworkRequired(error)).toBe(true);
    expect((error as Error).message).toBe(COPY.wrongNetwork);
  });
});
