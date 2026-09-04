import { useEffect, useState, type FormEvent } from "react";
import {
  BrowserRouter,
  Link,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { COPY, type ProfileResponse } from "@onlykas/shared";
import { authenticate, kasware, WalletError, api } from "./kasware.js";
import { PublishPage } from "./PublishPage.js";
import { MembershipPage } from "./MembershipPage.js";
import { CreatorPage, PostPage } from "./PublicPages.js";
import { FindCreatorPage } from "./FindCreatorPage.js";
import { Icon } from "./Icons.js";
import { useAutoDismiss } from "./useAutoDismiss.js";

export function App() {
  const [address, setAddress] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [profileName, setProfileName] = useState("");
  const [savingName, setSavingName] = useState(false);

  useAutoDismiss(walletError, () => setWalletError(null));

  useEffect(() => {
    if (!address) {
      setProfile(null);
      setProfileName("");
      return;
    }
    void api<ProfileResponse>("/api/profile")
      .then((value) => {
        setProfile(value);
        setProfileName(value.displayName ?? "");
      })
      .catch(() => undefined);
  }, [address]);

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

  async function signIn(): Promise<string | null> {
    if (signingIn) return null;
    setSigningIn(true);
    setWalletError(null);
    try {
      const authenticatedAddress = await authenticate();
      setAddress(authenticatedAddress);
      return authenticatedAddress;
    } catch (error) {
      setWalletError(
        error instanceof WalletError ? error.message : COPY.verificationFailed,
      );
      return null;
    } finally {
      setSigningIn(false);
    }
  }

  async function signOut() {
    setAddress(null);
    setWalletError(null);
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
  }

  async function saveName() {
    setSavingName(true);
    try {
      const value = await api<ProfileResponse>("/api/profile", {
        method: "PUT",
        body: JSON.stringify({ displayName: profileName }),
      });
      setProfile(value);
      setProfileName(value.displayName ?? "");
    } catch (error) {
      setWalletError(
        error instanceof Error ? error.message : "Name could not be saved.",
      );
    } finally {
      setSavingName(false);
    }
  }

  return (
    <BrowserRouter>
      <div className="shell">
        <nav>
          <Link to="/" className="brand">
            ONLY<span>KAS</span>
          </Link>
          <div className="nav-group">
            <GlobalSearch />
            <Link to="/membership" className="nav-link">
              Membership
            </Link>
            {address ? (
              <details className="account">
                <summary
                  aria-label={`Your account ${profile?.displayName ?? "Add your name"}`}
                >
                  <Icon name="user" /> Hi, {profile?.displayName ?? "there"}!
                </summary>
                <div className="account-menu">
                  <label htmlFor="display-name">Your name</label>
                  <input
                    id="display-name"
                    value={profileName}
                    onChange={(event) => setProfileName(event.target.value)}
                    placeholder="How should we call you?"
                    maxLength={40}
                  />
                  <button
                    className="menu-button"
                    disabled={savingName}
                    onClick={() => void saveName()}
                  >
                    {savingName ? "Saving..." : "Save name"}{" "}
                    <Icon name="check" />
                  </button>
                  <p className="account-address">{shorten(address)}</p>
                  <button
                    className="menu-button"
                    onClick={() => void signOut()}
                  >
                    Sign out
                  </button>
                </div>
              </details>
            ) : (
              <button
                className="nav-account-action"
                disabled={signingIn}
                onClick={() => void signIn()}
                aria-label="Sign in with Kasware"
                title="Sign in with Kasware"
              >
                {signingIn ? "Signing in..." : "Sign in"}
              </button>
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
            <Route
              path="/membership"
              element={
                <MembershipPage
                  address={address}
                  signIn={signIn}
                  signingIn={signingIn}
                />
              }
            />
            <Route
              path="/creator/:address"
              element={
                <CreatorPage
                  wallet={address}
                  signIn={signIn}
                  signingIn={signingIn}
                />
              }
            />
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
          <span>Test environment</span>
          <span>Private by design</span>
        </footer>
      </div>
    </BrowserRouter>
  );
}

function GlobalSearch() {
  const location = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  useEffect(() => {
    setQuery(new URLSearchParams(location.search).get("q") ?? "");
  }, [location.search]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    if (value) navigate(`/find?q=${encodeURIComponent(value)}`);
  }

  return (
    <form className="global-search" onSubmit={submitSearch} role="search">
      <label htmlFor="global-search-input" className="sr-only">
        Search by name or Kaspa address
      </label>
      <input
        id="global-search-input"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Name or Kaspa address"
        autoComplete="off"
        spellCheck={false}
      />
      <button type="submit" aria-label="Search">
        <Icon name="search" />
      </button>
    </form>
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
