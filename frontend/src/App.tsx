import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { BrowserRouter, Link, Route, Routes, useLocation } from "react-router-dom";
import type { ProfileResponse } from "@onlykas/shared";
import { COPY } from "./copy.js";
import { authenticate, kasware, api } from "./kasware.js";
import { HomePage } from "./HomePage.js";
import { PublishPage } from "./PublishPage.js";
import { CreatorPage } from "./CreatorPage.js";
import { PostPage } from "./PostPage.js";
import { FindCreatorPage } from "./FindCreatorPage.js";
import { PublicCreatorsPage } from "./PublicCreatorsPage.js";
import { FeedbackButton } from "./FeedbackButton.js";
import { SocialLinks } from "./SocialLinks.js";
import { GlobalSearch } from "./GlobalSearch.js";
import { AccountMenu } from "./AccountMenu.js";
import { HomeLink, Message } from "./Message.js";
import { errorText } from "./errors.js";
import { Toast, useToast } from "./Toast.js";

export function App() {
  const mainRef = useRef<HTMLElement>(null);
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
        if (!active) return;
        const message = errorText(error, "Profile could not be loaded.");
        setProfileError(message);
        showToast(message, "error");
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
      showToast(errorText(error, COPY.verificationFailed), "error");
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
      showToast(errorText(error, "Name could not be saved."), "error");
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
        <ScrollReset target={mainRef} />
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
              <AccountMenu
                address={address}
                displayName={profile?.displayName ?? null}
                name={profileName}
                loading={loadingProfile}
                error={profileError}
                saving={savingName}
                onNameChange={setProfileName}
                onSaveName={() => void saveName()}
                onSignOut={() => void signOut()}
              />
            ) : (
              <button
                className="nav-account-action"
                disabled={signingIn || checkingSession}
                onClick={() => void signIn()}
                aria-label="Sign in with Kasware"
                title="Sign in with Kasware"
              >
                {signInLabel(checkingSession, signingIn)}
              </button>
            )}
          </div>
        </nav>
        <Toast toast={toast} onDismiss={dismissToast} />
        <main ref={mainRef}>
          <Routes>
            <Route path="/" element={<HomePage />} />
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

function ScrollReset({ target }: { target: RefObject<HTMLElement | null> }) {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    if (target.current) target.current.scrollTop = 0;
  }, [pathname, target]);
  return null;
}

function MessageNotFound() {
  return (
    <Message title="Page not found.">
      <HomeLink />
    </Message>
  );
}

function signInLabel(checkingSession: boolean, signingIn: boolean): string {
  if (checkingSession) return "Checking session...";
  if (signingIn) return "Signing in...";
  return "Sign in";
}
