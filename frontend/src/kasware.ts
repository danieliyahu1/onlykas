import { COPY, NETWORK } from "@onlykas/shared";

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

export async function signPreparedPayment(
  transaction: string,
): Promise<string> {
  try {
    const inputs =
      (JSON.parse(transaction) as { inputs?: unknown[] }).inputs ?? [];
    return await kasware().signPskt({
      txJsonString: transaction,
      options: {
        signInputs: inputs.map((_, index) => ({ index, sighashType: 1 })),
      },
    });
  } catch {
    throw new WalletError(COPY.transactionRejected);
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

export async function authenticate(): Promise<string> {
  console.info("[OnlyKas auth] started");
  const wallet = kasware();
  let accounts = await wallet.getAccounts();
  console.info("[OnlyKas auth] wallet accounts checked", {
    count: accounts.length,
  });
  if (!accounts[0]) {
    try {
      console.info("[OnlyKas auth] requesting wallet accounts");
      accounts = await wallet.requestAccounts();
    } catch {
      console.error("[OnlyKas auth] account request cancelled or failed");
      throw new WalletError(COPY.walletCancelled);
    }
  }
  const address = accounts[0];
  if (!address) throw new WalletError(COPY.walletCancelled);
  console.info("[OnlyKas auth] wallet address received", {
    address: shortenAddress(address),
  });
  if ((await wallet.getNetwork()) !== NETWORK) {
    try {
      console.info("[OnlyKas auth] switching network", { network: NETWORK });
      await wallet.switchNetwork(NETWORK);
    } catch {
      console.error("[OnlyKas auth] network switch failed");
      throw new WalletError(COPY.wrongNetwork);
    }
    if ((await wallet.getNetwork()) !== NETWORK)
      throw new WalletError(COPY.wrongNetwork);
  }
  console.info("[OnlyKas auth] network ready", { network: NETWORK });
  const challenge = await api<{ challengeId: string; message: string }>(
    "/api/auth/challenge",
    { method: "POST", body: JSON.stringify({ address }) },
  );
  let signature: string;
  try {
    console.info("[OnlyKas auth] requesting wallet signature");
    signature = await wallet.signMessage(challenge.message);
  } catch {
    console.error("[OnlyKas auth] signature cancelled or failed");
    throw new WalletError(COPY.signInCancelled);
  }
  console.info("[OnlyKas auth] signature received", {
    length: signature.length,
  });
  const publicKey = await wallet.getPublicKey();
  console.info("[OnlyKas auth] public key received");
  await api("/api/auth/session", {
    method: "POST",
    body: JSON.stringify({
      challengeId: challenge.challengeId,
      address,
      publicKey,
      signature,
    }),
  });
  console.info("[OnlyKas auth] session established", {
    address: shortenAddress(address),
  });
  return address;
}

export async function api<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  console.info("[OnlyKas api] request", {
    method: init?.method ?? "GET",
    path,
  });
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  const body =
    response.status === 204
      ? null
      : ((await response.json()) as { error?: string; message?: string });
  if (!response.ok)
    console.error("[OnlyKas api] failed", {
      method: init?.method ?? "GET",
      path,
      status: response.status,
      message: body?.message,
    });
  if (!response.ok)
    throw new Error(body?.message ?? "The request could not be completed.");
  console.info("[OnlyKas api] success", {
    method: init?.method ?? "GET",
    path,
    status: response.status,
  });
  return body as T;
}

function shortenAddress(address: string) {
  return `${address.slice(0, 10)}...${address.slice(-6)}`;
}
