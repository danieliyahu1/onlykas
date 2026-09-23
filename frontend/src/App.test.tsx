import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_NETWORK, networkDefinition } from "@onlykas/shared";
import { App } from "./App.js";
import { COPY } from "./copy.js";
import {
  NETWORK_SWITCH_REQUIRED_EVENT,
  NETWORK_SWITCHED_EVENT,
  api,
  authenticate,
  type Kasware,
} from "./kasware.js";
import { reloadPage } from "./navigation.js";

const walletNetwork = networkDefinition(DEFAULT_NETWORK).walletNetwork;

vi.mock("./kasware.js", async () => ({
  ...(await vi.importActual("./kasware.js")),
  api: vi.fn(),
  authenticate: vi.fn(),
}));
vi.mock("./navigation.js", () => ({ reloadPage: vi.fn() }));

const signedInAddress = `kaspatest:${"q".repeat(60)}`;
const otherAddress = `kaspatest:${"p".repeat(60)}`;

const apiMock = api as unknown as ReturnType<typeof vi.fn>;
const authenticateMock = authenticate as unknown as ReturnType<typeof vi.fn>;
const reloadMock = vi.mocked(reloadPage);

type WalletHandlers = {
  accountsChanged?: () => void;
  networkChanged?: () => void;
};

let handlers: WalletHandlers;

function installWallet(overrides: Record<string, unknown> = {}) {
  handlers = {};
  const wallet = {
    getAccounts: vi.fn(async () => [] as string[]),
    requestAccounts: vi.fn(async () => [] as string[]),
    getNetwork: vi.fn(async (): Promise<string> => walletNetwork),
    switchNetwork: vi.fn(async () => undefined),
    getPublicKey: vi.fn(async () => "public-key"),
    signMessage: vi.fn(async () => "signature"),
    signPskt: vi.fn(async () => ""),
    on: vi.fn((event: "accountsChanged" | "networkChanged", handler: () => void) => {
      handlers[event] = handler;
    }),
    removeListener: vi.fn(),
    ...overrides,
  };
  window.kasware = wallet as unknown as Kasware;
  return wallet;
}

function mockApi(setup: { session?: { address: string }; profile?: unknown } = {}) {
  apiMock.mockImplementation(async (path: string) => {
    if (path === "/api/auth/session") {
      if (setup.session) return setup.session;
      throw new Error("AUTH_REQUIRED");
    }
    if (path === "/api/profile") {
      return (
        setup.profile ?? {
          address: signedInAddress,
          displayAddress: "kaspatest:qqq...qqq",
          displayName: null,
          isPublic: false,
        }
      );
    }
    if (path === "/api/auth/logout") return undefined;
    return [];
  });
}

function browser() {
  return { user: userEvent.setup() };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete window.kasware;
});

afterEach(() => {
  delete window.kasware;
});

describe("session and wallet reconciliation", () => {
  it("restores the server session when Kasware is not installed", async () => {
    mockApi({ session: { address: signedInAddress } });

    render(<App />);

    expect(await screen.findByText(/Hi,/i)).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith("/api/auth/session");
    expect(apiMock).not.toHaveBeenCalledWith("/api/auth/logout", expect.anything());
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("shows the sign-in button when Kasware is not installed and there is no session", async () => {
    mockApi();

    render(<App />);

    expect(
      await screen.findByRole("button", { name: "Sign in with Kasware" }),
    ).toBeInTheDocument();
  });

  it("keeps the signed-in header when the wallet withholds its accounts", async () => {
    installWallet({ getAccounts: vi.fn(async () => []) });
    mockApi({ session: { address: signedInAddress } });

    render(<App />);

    expect(await screen.findByText(/Hi,/i)).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalledWith("/api/auth/logout", expect.anything());
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("does nothing when the wallet re-announces the signed-in account", async () => {
    installWallet({ getAccounts: vi.fn(async () => [signedInAddress]) });
    mockApi({ session: { address: signedInAddress } });

    render(<App />);
    expect(await screen.findByText(/Hi,/i)).toBeInTheDocument();

    handlers.accountsChanged?.();

    await waitFor(() =>
      expect(apiMock).not.toHaveBeenCalledWith("/api/auth/logout", expect.anything()),
    );
    expect(screen.getByText(/Hi,/i)).toBeInTheDocument();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("signs out when the wallet switches to a different account", async () => {
    const wallet = installWallet({
      getAccounts: vi.fn(async () => [signedInAddress]),
    });
    mockApi({ session: { address: signedInAddress } });

    render(<App />);
    expect(await screen.findByText(/Hi,/i)).toBeInTheDocument();

    wallet.getAccounts.mockResolvedValue([otherAddress]);
    handlers.accountsChanged?.();

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith("/api/auth/logout", expect.anything()),
    );
    expect(reloadMock).toHaveBeenCalled();
    expect(
      await screen.findByRole("button", { name: "Sign in with Kasware" }),
    ).toBeInTheDocument();
  });

  it("keeps the session when the wallet changes network on its own", async () => {
    const wallet = installWallet({
      getAccounts: vi.fn(async () => [signedInAddress]),
    });
    mockApi({ session: { address: signedInAddress } });

    render(<App />);
    expect(await screen.findByText(/Hi,/i)).toBeInTheDocument();

    wallet.getNetwork.mockResolvedValue("kaspa_mainnet");
    handlers.networkChanged?.();

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/profile"));
    expect(screen.queryByText(COPY.wrongNetwork)).not.toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalledWith("/api/auth/logout", expect.anything());
    expect(screen.getByText(/Hi,/i)).toBeInTheDocument();
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("finishes sign-in when the wallet re-announces the network mid-flight", async () => {
    installWallet();
    mockApi();
    authenticateMock.mockImplementation(async () => {
      handlers.networkChanged?.();
      return signedInAddress;
    });

    render(<App />);
    const { user } = browser();
    const signIn = await screen.findByRole("button", { name: "Sign in with Kasware" });
    await user.click(signIn);

    expect(await screen.findByText(/Hi,/i)).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalledWith("/api/auth/logout", expect.anything());
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("prompts when an action opens the wallet's network switcher", async () => {
    installWallet();
    mockApi();

    render(<App />);

    act(() => {
      window.dispatchEvent(new Event(NETWORK_SWITCH_REQUIRED_EVENT));
    });

    expect(await screen.findByText(COPY.wrongNetwork)).toBeInTheDocument();
  });

  it("confirms a successful network switch by its display name", async () => {
    installWallet();
    mockApi();

    render(<App />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent<string>(NETWORK_SWITCHED_EVENT, {
          detail: "Testnet 10",
        }),
      );
    });

    expect(
      await screen.findByText(COPY.networkSwitched.replace("{network}", "Testnet 10")),
    ).toBeInTheDocument();
  });

  it("signs out only when the user asks", async () => {
    installWallet({ getAccounts: vi.fn(async () => [signedInAddress]) });
    mockApi({ session: { address: signedInAddress } });

    render(<App />);
    expect(await screen.findByText(/Hi,/i)).toBeInTheDocument();

    const { user } = browser();
    await user.click(screen.getByText("Sign out"));

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith("/api/auth/logout", expect.anything()),
    );
    expect(reloadMock).toHaveBeenCalled();
  });
});
