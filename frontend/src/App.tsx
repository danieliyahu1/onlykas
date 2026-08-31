import { useEffect, useState } from "react";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { COPY } from "@onlykas/shared";
import { authenticate, kasware, WalletError, api } from "./kasware.js";
import { PublishPage } from "./PublishPage.js";
import { CreatorPage, PostPage } from "./PublicPages.js";
import { FindCreatorPage } from "./FindCreatorPage.js";

export function App() {
  const [address, setAddress] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);

  useEffect(() => {
    let wallet;
    try {
      wallet = kasware();
    } catch {
      return;
    }
    void (async () => {
      try {
        const [accounts, session] = await Promise.all([
          wallet.getAccounts(),
          api<{ address: string }>("/api/auth/session"),
        ]);
        if (accounts[0] && accounts[0] === session.address)
          setAddress(session.address);
      } catch {
        // A missing or expired server session simply requires sign-in.
      }
    })();
    const changed = () => {
      setAddress(null);
      setWalletError(null);
      void api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    };
    wallet.on("accountsChanged", changed);
    wallet.on("networkChanged", changed);
    return () => {
      wallet.removeListener("accountsChanged", changed);
      wallet.removeListener("networkChanged", changed);
    };
  }, []);

  async function signIn() {
    if (signingIn) return;
    setSigningIn(true);
    setWalletError(null);
    try {
      setAddress(await authenticate());
    } catch (error) {
      setWalletError(
        error instanceof WalletError ? error.message : COPY.verificationFailed,
      );
    } finally {
      setSigningIn(false);
    }
  }

  async function signOut() {
    setAddress(null);
    setWalletError(null);
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
  }

  return (
    <BrowserRouter>
      <div className="shell">
        <nav>
          <Link to="/" className="brand">
            ONLY<span>KAS</span>
          </Link>
          <div className="nav-group">
            <Link to="/find" className="nav-action">
              Find
            </Link>
            {address && (
              <details className="account">
                <summary>Connected</summary>
                <div className="account-menu">
                  <span>{shorten(address)}</span>
                  <button
                    className="menu-button"
                    onClick={() => void signOut()}
                  >
                    Sign out
                  </button>
                </div>
              </details>
            )}
          </div>
        </nav>
        {walletError && (
          <div className="global-error" role="alert">
            {walletError}
          </div>
        )}
        <main>
          <Routes>
            <Route
              path="/"
              element={
                <PublishPage
                  address={address}
                  signIn={signIn}
                  signingIn={signingIn}
                />
              }
            />
            <Route
              path="/publish"
              element={
                <PublishPage
                  address={address}
                  signIn={signIn}
                  signingIn={signingIn}
                />
              }
            />
            <Route path="/find" element={<FindCreatorPage />} />
            <Route path="/creator/:address" element={<CreatorPage />} />
            <Route
              path="/post/:id"
              element={
                <PostPage
                  address={address}
                  signIn={signIn}
                  signingIn={signingIn}
                />
              }
            />
            <Route path="*" element={<MessageNotFound />} />
          </Routes>
        </main>
        <footer>
          <span>Testnet-10</span>
          <span>Private by design</span>
        </footer>
      </div>
    </BrowserRouter>
  );
}

function shorten(address: string) {
  return `${address.slice(0, 10)}...${address.slice(-6)}`;
}

function MessageNotFound() {
  return (
    <section className="message">
      <p className="eyebrow">ONLYKAS</p>
      <h1>That link is gone.</h1>
      <Link className="secondary" to="/">
        Back home
      </Link>
    </section>
  );
}
