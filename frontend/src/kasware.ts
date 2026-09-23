import { networkDisplayName, walletNetworkName } from "./app-config.js";
import { ApiError, toApiError, type ApiErrorBody } from "./api-error.js";
import { COPY } from "./copy.js";
import { logger } from "./logger.js";

export { ApiError };

export interface Kasware {
  requestAccounts(): Promise<string[]>;
  getAccounts(): Promise<string[]>;
  getNetwork(): Promise<string>;
  switchNetwork(network: string): Promise<void>;
  getPublicKey(): Promise<string>;
  signMessage(message: string): Promise<string>;
  signPskt(request: {
    txJsonString: string;
    options?: { signInputs?: { index: number; sighashType: number }[] };
  }): Promise<string>;
  on(event: "accountsChanged" | "networkChanged", handler: () => void): void;
  removeListener(
    event: "accountsChanged" | "networkChanged",
    handler: () => void,
  ): void;
}

export async function getWalletPublicKey(): Promise<string> {
  const wallet = kasware();
  const network = await wallet.getPublicKey();
  return network;
}

export async function signPreparedPayment(
  transaction: string,
  signInputs?: number[],
): Promise<string> {
  await ensureWalletNetwork();
  try {
    const inputs = (JSON.parse(transaction) as { inputs?: unknown[] }).inputs ?? [];
    return await kasware().signPskt({
      txJsonString: transaction,
      options: {
        signInputs: (signInputs ?? inputs.map((_, index) => index)).map((index) => ({
          index,
          sighashType: 1,
        })),
      },
    });
  } catch (caught) {
    const detail = caught instanceof Error ? ` (${caught.message})` : "";
    throw new WalletError(`${COPY.transactionRejected}${detail}`);
  }
}

declare global {
  interface Window {
    kasware?: Kasware;
  }
}

export class WalletError extends Error {}

export function kasware(): Kasware {
  if (!window.kasware) throw new WalletError(COPY.kaswareMissing);
  return window.kasware;
}

export function walletOrNull(): Kasware | null {
  return window.kasware ?? null;
}

const NETWORK_SWITCH_TIMEOUT_MS = 10_000;
const NETWORK_POLL_INTERVAL_MS = 500;
const NETWORK_QUIET_WINDOW_MS = 1_000;

/** The wallet needs a network switch and its switcher is being opened. */
export const NETWORK_SWITCH_REQUIRED_EVENT = "onlykas:network-switch-required";
/** The wallet landed on the right network; the detail is its display name. */
export const NETWORK_SWITCHED_EVENT = "onlykas:network-switched";

/**
 * True from the moment an action opens the wallet's switcher until a short
 * quiet window after it settles. The background wallet listener checks this so
 * it stays quiet and lets the action own the message, even when the wallet
 * re-announces the network just after the switch.
 */
let switchingNetwork = false;
let quietTimer: number | undefined;

export function isSwitchingNetwork(): boolean {
  return switchingNetwork;
}

function holdQuietWindow(): void {
  if (quietTimer !== undefined) window.clearTimeout(quietTimer);
  quietTimer = window.setTimeout(() => {
    switchingNetwork = false;
    quietTimer = undefined;
  }, NETWORK_QUIET_WINDOW_MS);
}

function announce(event: string, detail?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    detail === undefined
      ? new Event(event)
      : new CustomEvent<string>(event, { detail }),
  );
}

export class WalletNetworkError extends WalletError {}

/**
 * Blocks until the wallet is on the network the server selected. When a switch
 * is needed it opens the wallet's switcher, announces it for the UI, and gives
 * the user ten seconds to approve. A rejection, a dismissal, or the deadline
 * ends the action quietly: the user already has the wrong-network notice, so
 * nothing more is said. Only a switch we could not start is a real error.
 */
export async function ensureWalletNetwork(): Promise<void> {
  const wallet = kasware();
  const expected = walletNetworkName();
  if ((await wallet.getNetwork()) === expected) return;

  switchingNetwork = true;
  try {
    announce(NETWORK_SWITCH_REQUIRED_EVENT);
    const approved = await requestNetworkSwitch(wallet, expected);
    if (!approved) throw new WalletNetworkError(COPY.wrongNetwork);
    announce(NETWORK_SWITCHED_EVENT, networkDisplayName());
  } finally {
    holdQuietWindow();
  }
}

async function requestNetworkSwitch(
  wallet: Kasware,
  expected: string,
): Promise<boolean> {
  let settled = false;
  let settle: (approved: boolean) => void = () => undefined;
  const decision = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  const finish = (approved: boolean) => {
    if (settled) return;
    settled = true;
    settle(approved);
  };
  const check = async () => {
    if ((await wallet.getNetwork().catch(() => expected)) === expected) {
      finish(true);
    }
  };
  const onChanged = () => void check();
  wallet.on("networkChanged", onChanged);
  const poll = window.setInterval(() => void check(), NETWORK_POLL_INTERVAL_MS);
  const deadline = window.setTimeout(() => finish(false), NETWORK_SWITCH_TIMEOUT_MS);
  try {
    try {
      void wallet.switchNetwork(expected).catch(() => finish(false));
    } catch {
      finish(false);
    }
    return await decision;
  } finally {
    window.clearInterval(poll);
    window.clearTimeout(deadline);
    wallet.removeListener("networkChanged", onChanged);
  }
}

export async function authenticate(): Promise<string> {
  logger.info("auth_started");
  const wallet = kasware();
  let accounts = await wallet.getAccounts();
  logger.debug("auth_wallet_accounts_checked", {
    count: accounts.length,
  });
  if (!accounts[0]) {
    try {
      logger.debug("auth_requesting_wallet_accounts");
      accounts = await wallet.requestAccounts();
    } catch {
      logger.error("auth_account_request_failed");
      throw new WalletError(COPY.walletCancelled);
    }
  }
  const address = accounts[0];
  if (!address) throw new WalletError(COPY.walletCancelled);
  logger.info("auth_wallet_address_received", {
    address: shortenAddress(address),
  });
  const network = walletNetworkName();
  try {
    logger.info("auth_switching_network", { network });
    await ensureWalletNetwork();
  } catch (caught) {
    logger.error("auth_network_switch_failed", { network });
    if (caught instanceof WalletNetworkError) throw caught;
    throw new WalletError(COPY.wrongNetwork);
  }
  logger.info("auth_network_ready", { network });
  const challenge = await api<{ challengeId: string; message: string }>(
    "/api/auth/challenge",
    { method: "POST", body: JSON.stringify({ address }) },
  );
  let signature: string;
  try {
    logger.info("auth_requesting_wallet_signature");
    signature = await wallet.signMessage(challenge.message);
  } catch {
    logger.error("auth_signature_failed");
    throw new WalletError(COPY.signInCancelled);
  }
  logger.debug("auth_signature_received", {
    length: signature.length,
  });
  const publicKey = await wallet.getPublicKey();
  logger.debug("auth_public_key_received");
  await api("/api/auth/session", {
    method: "POST",
    body: JSON.stringify({
      challengeId: challenge.challengeId,
      address,
      publicKey,
      signature,
    }),
  });
  logger.info("auth_session_established", {
    address: shortenAddress(address),
  });
  return address;
}

export const SESSION_EXPIRED_EVENT = "onlykas:session-expired";

const SESSION_PATH = "/api/auth/session";

function notifySessionExpired() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
}

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  logger.debug("api_request", {
    method: init?.method ?? "GET",
    path,
  });
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  }).catch(() => {
    throw new ApiError("SERVER_UNAVAILABLE", COPY.serverDown, 0);
  });
  const headerRequestId = response.headers.get("x-request-id") ?? undefined;
  const body =
    response.status === 204 ? null : ((await response.json()) as ApiErrorBody);
  if (!response.ok) {
    const error = toApiError(response.status, {
      ...(body ?? {}),
      requestId: body?.requestId ?? headerRequestId,
    });
    if (response.status === 401 && path !== SESSION_PATH) notifySessionExpired();
    logger.error("api_failed", {
      method: init?.method ?? "GET",
      path,
      status: response.status,
      code: error.code,
      message: error.message,
      requestId: error.requestId,
    });
    throw error;
  }
  logger.debug("api_success", {
    method: init?.method ?? "GET",
    path,
    status: response.status,
    requestId: headerRequestId,
  });
  return body as T;
}

function shortenAddress(address: string) {
  return `${address.slice(0, 10)}...${address.slice(-6)}`;
}
