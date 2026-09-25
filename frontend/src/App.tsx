import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { BrowserRouter, Link, Route, Routes, useLocation } from "react-router-dom";
import { PUBLIC_PAGES, type ProfileResponse } from "@onlykas/shared";
import { walletNetworkName } from "./app-config.js";
import { COPY } from "./copy.js";
import {
  authenticate,
  walletOrNull,
  api,
  isSwitchingNetwork,
  SESSION_EXPIRED_EVENT,
  NETWORK_SWITCH_REQUIRED_EVENT,
  NETWORK_SWITCHED_EVENT,
} from "./kasware.js";
import { HomePage } from "./HomePage.js";
import { PublishPage } from "./PublishPage.js";
import { CreatorPage } from "./CreatorPage.js";
import { PostPage } from "./PostPage.js";
import { FindCreatorPage } from "./FindCreatorPage.js";
import { PublicCreatorsPage } from "./PublicCreatorsPage.js";
import { FeedbackButton } from "./FeedbackButton.js";
import { LegalPage } from "./LegalPage.js";
import { SocialLinks } from "./SocialLinks.js";
import { GlobalSearch } from "./GlobalSearch.js";
import { AccountMenu } from "./AccountMenu.js";
import { HomeLink, Message } from "./Message.js";
import { Spinner } from "./Spinner.js";
import { errorText, isNetworkRequired } from "./errors.js";
import { Toast, useToast } from "./Toast.js";
import { reloadPage } from "./navigation.js";

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
  const signedInAddress = useRef<string | null>(null);

  useEffect(() => {
    signedInAddress.current = address;
  }, [address]);

  useEffect(() => {
    const expired = () => {
      if (signedInAddress.current) reloadPage();
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
  }, []);

  useEffect(() => {
    const required = () => showToast(COPY.wrongNetwork, "notice");
    const switched = (event: Event) => {
      const name = (event as CustomEvent<string>).detail;
      showToast(COPY.networkSwitched.replace("{network}", name), "success");
    };
    window.addEventListener(NETWORK_SWITCH_REQUIRED_EVENT, required);
    window.addEventListener(NETWORK_SWITCHED_EVENT, switched);
    return () => {
      window.removeEventListener(NETWORK_SWITCH_REQUIRED_EVENT, required);
      window.removeEventListener(NETWORK_SWITCHED_EVENT, switched);
    };
  }, [showToast]);

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
    let reconciling = false;
    const wallet = walletOrNull();
    const reconcile = async () => {
      const signedIn = signedInAddress.current;
      if (!signedIn || reconciling || !wallet) return;
      reconciling = true;
      try {
        const accounts = await wallet.getAccounts().catch(() => []);
        const walletAddress = accounts[0];
        if (!walletAddress) return;
        if (!sameAddress(walletAddress, signedIn)) {
          await signOut();
          return;
        }
        if (isSwitchingNetwork()) return;
        const network = walletNetworkName();
        const activeNetwork = await wallet.getNetwork().catch(() => network);
        if (activeNetwork !== network) showToast(COPY.wrongNetwork, "notice");
      } finally {
        reconciling = false;
      }
    };
    void (async () => {
      let restored: string | null = null;
      try {
        const session = await api<{ address: string }>("/api/auth/session");
        restored = session.address;
        if (active) setAddress(session.address);
      } catch {
        // A missing or expired server session simply requires sign-in.
      }
      if (restored && active && wallet) {
        const accounts = await wallet.getAccounts().catch(() => []);
        if (accounts[0] && !sameAddress(accounts[0], restored)) {
          await signOut();
          return;
        }
      }
      if (active) setCheckingSession(false);
    })();
    if (wallet) {
      const changed = () => {
        if (!signedInAddress.current) return;
        void reconcile();
      };
      wallet.on("accountsChanged", changed);
      wallet.on("networkChanged", changed);
      return () => {
        active = false;
        wallet.removeListener("accountsChanged", changed);
        wallet.removeListener("networkChanged", changed);
      };
    }
    return () => {
      active = false;
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
      if (!isNetworkRequired(error))
        showToast(errorText(error, COPY.verificationFailed), "error");
      return null;
    } finally {
      setSigningIn(false);
    }
  }

  async function signOut() {
    setAddress(null);
    dismissToast();
    await logoutAndReload();
  }

  async function logoutAndReload() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    reloadPage();
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
            <Link to="/publish" className="nav-link">
              Publish
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
                className="nav-link"
                disabled={signingIn || checkingSession}
                onClick={() => void signIn()}
                aria-label="Sign in with Kasware"
                title="Sign in with Kasware"
              >
                {(signingIn || checkingSession) && <Spinner />}
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
            {PUBLIC_PAGES.map((page) => (
              <Route
                key={page.path}
                path={page.path}
                element={<LegalPage page={page} />}
              />
            ))}
            <Route path="*" element={<MessageNotFound />} />
          </Routes>
        </main>
        <footer>
          <span>Early access</span>
          <nav className="legal-links" aria-label="Legal">
            {PUBLIC_PAGES.map((page) => (
              <Link key={page.path} to={page.path}>
                {page.navLabel}
              </Link>
            ))}
          </nav>
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

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
