import { useEffect, useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import { COPY } from "@onlykas/shared";
import { authenticate, kasware, WalletError, api } from "./kasware.js";
import { PublishPage } from "./PublishPage.js";
import { CreatorPage, PostPage } from "./PublicPages.js";

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

  return (
    <BrowserRouter>
      <div className="shell">
        <nav>
          <Link to="/" className="brand">
            ONLY<span>KAS</span>
          </Link>
          <Link to="/publish">Publish</Link>
          {address && (
            <span className="identity">{address.slice(0, 10)}...</span>
          )}
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
            <Route path="/publish" element={<Navigate to="/" replace />} />
            <Route path="/creator/:address" element={<CreatorPage />} />
            <Route path="/post/:id" element={<PostPage />} />
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
