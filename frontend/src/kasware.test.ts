import { COPY, NETWORK } from "@onlykas/shared";
import { api, authenticate } from "./kasware.js";

const address = `kaspatest:${"q".repeat(60)}`;

describe("Kasware authentication", () => {
  it("binds the backend challenge to the selected testnet account and public key", async () => {
    const wallet = {
      getAccounts: vi.fn(async () => [address]),
      requestAccounts: vi.fn(),
      getNetwork: vi.fn(async () => NETWORK),
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
});
