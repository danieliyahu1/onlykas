import { useEffect, useState, type FormEvent } from "react";
import {
  BrowserRouter,
  Link,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import type { ProfileResponse } from "@onlykas/shared";
import { COPY } from "./copy.js";
import { authenticate, kasware, WalletError, ApiError, api } from "./kasware.js";
import { PublishPage } from "./PublishPage.js";
import { CreatorPage, PostPage } from "./PublicPages.js";
import { FindCreatorPage } from "./FindCreatorPage.js";
import { PublicCreatorsPage } from "./PublicCreatorsPage.js";
import { FeedbackButton } from "./FeedbackButton.js";
import { SocialLinks } from "./SocialLinks.js";
import { Icon } from "./Icons.js";
import { Toast, useToast } from "./Toast.js";

export function App() {
  const [address, setAddress] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileName, setProfileName] = useState("");
  const [savingName, setSavingName] = useState(false);

  const { toast, showToast, dismissToast } = useToast();

  useEffect(() => {
    if (!address) {
      setProfile(null);
      setProfileName("");
      setLoadingProfile(false);
      setProfileError(null);
      return;
    }
    let active = true;
    setLoadingProfile(true);
    setProfileError(null);
    void api<ProfileResponse>("/api/profile")
      .then((value) => {
        if (!active) return;
        setProfile(value);
        setProfileName(value.displayName ?? "");
      })
      .catch((error: unknown) => {
        if (active) {
          const message =
            error instanceof Error ? error.message : "Profile could not be loaded.";
          setProfileError(message);
          showToast(message, "error");
        }
      })
      .finally(() => {
        if (active) setLoadingProfile(false);
      });
    return () => {
      active = false;
    };
  }, [address, showToast]);

  useEffect(() => {
    let active = true;
    let wallet;
    try {
      wallet = kasware();
    } catch {
      if (active) setCheckingSession(false);
      return;
    }
    void (async () => {
      try {
        const [accounts, session] = await Promise.all([
          wallet.getAccounts(),
          api<{ address: string }>("/api/auth/session"),
        ]);
        if (active && accounts[0] && accounts[0] === session.address)
          setAddress(session.address);
      } catch {
        // A missing or expired server session simply requires sign-in.
      } finally {
        if (active) setCheckingSession(false);
      }
    })();
    const changed = () => {
      setAddress(null);
      dismissToast();
      void api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    };
    wallet.on("accountsChanged", changed);
    wallet.on("networkChanged", changed);
    return () => {
      active = false;
      wallet.removeListener("accountsChanged", changed);
      wallet.removeListener("networkChanged", changed);
    };
  }, []);

  async function signIn(): Promise<string | null> {
    if (signingIn) return null;
    setSigningIn(true);
    dismissToast();
    try {
      const authenticatedAddress = await authenticate();
      setAddress(authenticatedAddress);
      return authenticatedAddress;
    } catch (error) {
      showToast(
        error instanceof WalletError || error instanceof ApiError
          ? error.message
          : COPY.verificationFailed,
        "error",
      );
      return null;
    } finally {
      setSigningIn(false);
    }
  }

  async function signOut() {
    setAddress(null);
    dismissToast();
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
      showToast(
        error instanceof Error ? error.message : "Name could not be saved.",
        "error",
      );
    } finally {
      setSavingName(false);
    }
  }

  async function saveVisibility(isPublic: boolean) {
    const value = await api<ProfileResponse>("/api/profile", {
      method: "PUT",
      body: JSON.stringify({ isPublic }),
    });
    setProfile(value);
    setProfileName(value.displayName ?? "");
    return value;
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
            <Link to="/creators" className="nav-link">
              Creators
            </Link>
            {address ? (
              <details className="account">
                <summary
                  aria-label={
                    loadingProfile
                      ? "Your account, checking profile"
                      : profileError
                        ? "Your account, profile unavailable"
                        : `Your account ${profile?.displayName ?? "Add your name"}`
                  }
                >
                  <Icon name="user" />{" "}
                  {loadingProfile
                    ? "Checking profile..."
                    : profileError
                      ? "Profile unavailable"
                      : `Hi, ${profile?.displayName ?? "there"}!`}
                </summary>
                <div className="account-menu">
                  <label htmlFor="display-name">Display name</label>
                  {loadingProfile ? (
                    <p className="account-loading">Loading profile...</p>
                  ) : profileError ? (
                    <p className="account-loading">{profileError}</p>
                  ) : (
                    <input
                      id="display-name"
                      value={profileName}
                      onChange={(event) => setProfileName(event.target.value)}
                      placeholder="Add a display name"
                      maxLength={40}
                    />
                  )}
                  <button
                    className="menu-button"
                    disabled={savingName || loadingProfile || Boolean(profileError)}
                    onClick={() => void saveName()}
                  >
                    {savingName ? "Saving..." : "Save"} <Icon name="check" />
                  </button>
                  <p className="account-address">{shorten(address)}</p>
                  <Link className="menu-button" to={`/creator/${address}`}>
                    Your page
                  </Link>
                  <button className="menu-button" onClick={() => void signOut()}>
                    Sign out
                  </button>
                </div>
              </details>
            ) : (
              <button
                className="nav-account-action"
                disabled={signingIn || checkingSession}
                onClick={() => void signIn()}
                aria-label="Sign in with Kasware"
                title="Sign in with Kasware"
              >
                {checkingSession
                  ? "Checking session..."
                  : signingIn
                    ? "Signing in..."
                    : "Sign in"}
              </button>
            )}
          </div>
        </nav>
        <Toast toast={toast} />
        <main>
          <Routes>
            <Route
              path="/"
              element={
                <PublishPage address={address} signIn={signIn} signingIn={signingIn} />
              }
            />
            <Route
              path="/publish"
              element={
                <PublishPage address={address} signIn={signIn} signingIn={signingIn} />
              }
            />
            <Route path="/find" element={<FindCreatorPage />} />
            <Route path="/creators" element={<PublicCreatorsPage />} />
            <Route
              path="/creator/:address"
              element={
                <CreatorPage
                  address={address}
                  signIn={signIn}
                  signingIn={signingIn}
                  onVisibilityChange={saveVisibility}
                />
              }
            />
            <Route
              path="/post/:id"
              element={
                <PostPage address={address} signIn={signIn} signingIn={signingIn} />
              }
            />
            <Route path="*" element={<MessageNotFound />} />
          </Routes>
        </main>
        <footer>
          <span>Kaspa testnet</span>
          <div className="footer-links">
            <SocialLinks />
            <FeedbackButton />
          </div>
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

  if (location.pathname === "/find") return null;

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
      <h1 className="message-title">Page not found.</h1>
      <Link className="secondary" to="/">
        Go home
      </Link>
    </section>
  );
}
