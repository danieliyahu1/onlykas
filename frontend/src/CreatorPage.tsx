import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { CreatorResponse, PostResponse } from "@onlykas/shared";
import { api, signPreparedPayment } from "./kasware.js";
import { Toast, useToast } from "./Toast.js";
import { LockIcon } from "./Icons.js";
import { HomeLink, Message } from "./Message.js";
import { errorText } from "./errors.js";
import { formatKas, shortenAddress } from "./format.js";
import type { WalletProps } from "./wallet.js";

type CreatorPageProps = WalletProps & {
  onVisibilityChange?: (isPublic: boolean) => Promise<unknown>;
};

export function CreatorPage({
  address,
  signIn,
  signingIn,
  onVisibilityChange,
}: CreatorPageProps) {
  const { address: creatorAddress = "" } = useParams();
  const [creator, setCreator] = useState<CreatorResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const { toast, showToast, dismissToast } = useToast();
  const requestId = useRef(0);

  async function loadCreator() {
    const currentRequest = ++requestId.current;
    const isNewCreator = creator?.address !== creatorAddress;
    if (isNewCreator) {
      setLoading(true);
      setCreator(null);
    } else {
      setRefreshing(true);
    }
    setLoadError(null);
    try {
      const value = await api<CreatorResponse>(
        `/api/creators/${encodeURIComponent(creatorAddress)}`,
      );
      if (currentRequest === requestId.current) setCreator(value);
    } catch (error) {
      if (currentRequest !== requestId.current) return;
      const message = errorText(error, "Creator could not be loaded.");
      if (isNewCreator) setLoadError(message);
      else showToast(message, "error");
    } finally {
      if (currentRequest === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }

  useEffect(() => {
    void loadCreator();
  }, [creatorAddress, address]);

  if (loading) return <Message title="Loading..." />;
  if (!creator)
    return (
      <Message title={loadError ?? "This creator isn't available."}>
        <HomeLink />
      </Message>
    );

  const currentCreator = creator;
  const owner = currentCreator.isOwner || address === currentCreator.address;
  const showSubscription =
    owner || currentCreator.membership.offered || currentCreator.membership.active;

  async function membershipAction() {
    const wallet = address ?? (await signIn());
    if (!wallet) return;
    const actingAsOwner = wallet === currentCreator.address;
    setBusy(true);
    dismissToast();
    try {
      const prepared = await prepareSubscription(actingAsOwner, currentCreator.address);
      const signedTransaction = await signPreparedPayment(
        prepared.transaction,
        prepared.signInputs,
      );
      const result = await finalizeSubscription(
        actingAsOwner,
        prepared.id,
        signedTransaction,
      );
      showToast(
        result.state === "CONFIRMED"
          ? actingAsOwner
            ? "Subscription is ready."
            : "Subscribed for 24 hours."
          : "Your payment is confirming. Don't pay again.",
        result.state === "CONFIRMED" ? "success" : "info",
      );
      if (result.state === "CONFIRMED") await loadCreator();
    } catch (error) {
      showToast(errorText(error, "Payment failed. Nothing was charged."), "error");
    } finally {
      setBusy(false);
    }
  }

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(currentCreator.address);
      showToast("Address copied.", "success");
    } catch {
      showToast("Couldn't copy the address.", "error");
    }
  }

  async function toggleVisibility() {
    if (!onVisibilityChange) return;
    setVisibilityBusy(true);
    dismissToast();
    const next = !currentCreator.isPublic;
    try {
      await onVisibilityChange(next);
      setCreator({ ...currentCreator, isPublic: next });
      showToast(next ? "Profile is public." : "Profile is private.", "success");
    } catch (error) {
      showToast(errorText(error, "Couldn't save visibility."), "error");
    } finally {
      setVisibilityBusy(false);
    }
  }

  return (
    <>
      <section className="profile">
        <div className="creator-identity">
          <h1 className={currentCreator.displayName ? undefined : "address-heading"}>
            {currentCreator.displayName ?? shortenAddress(currentCreator.address)}
          </h1>
          <button
            className="wallet-address"
            type="button"
            title={currentCreator.address}
            aria-label="Copy Kaspa address"
            onClick={() => void copyAddress()}
          >
            {shortenAddress(currentCreator.address)}
          </button>
          {owner && onVisibilityChange && (
            <div className="profile-visibility">
              <span>Visibility: {currentCreator.isPublic ? "Public" : "Private"}</span>
              <button
                className="text-button"
                type="button"
                disabled={visibilityBusy}
                onClick={() => void toggleVisibility()}
              >
                {visibilityBusy ? "Saving..." : "Change"}
              </button>
            </div>
          )}
        </div>
        {showSubscription && (
          <div className="access-strip">
            <p className="access-facts">Subscription · 24 hours · 10 KAS</p>
            <SubscriptionAction
              membership={currentCreator.membership}
              owner={owner}
              busy={busy}
              disabled={busy || signingIn}
              onAction={() => void membershipAction()}
            />
            {refreshing && <span className="access-status">Refreshing...</span>}
          </div>
        )}
        <div className="post-grid">
          {currentCreator.posts.length ? (
            currentCreator.posts.map((post) => <PostCard key={post.id} post={post} />)
          ) : (
            <div className="empty-posts">
              <p>No posts yet.</p>
              {owner && (
                <Link className="secondary" to="/">
                  Publish a post
                </Link>
              )}
            </div>
          )}
        </div>
      </section>
      <Toast toast={toast} />
    </>
  );
}

async function prepareSubscription(actingAsOwner: boolean, creatorAddress: string) {
  const path = actingAsOwner
    ? "/api/membership/offers/prepare"
    : `/api/membership/${encodeURIComponent(creatorAddress)}/prepare`;
  return api<{ id: string; transaction: string; signInputs: number[] }>(path, {
    method: "POST",
  });
}

async function finalizeSubscription(
  actingAsOwner: boolean,
  preparedId: string,
  signedTransaction: string,
) {
  const path = actingAsOwner
    ? `/api/membership/offers/${preparedId}/finalize`
    : `/api/membership/purchases/${preparedId}/finalize`;
  return api<{ state: string }>(path, {
    method: "POST",
    body: JSON.stringify({ signedTransaction }),
  });
}

function subscriptionLabel(owner: boolean, busy: boolean): string {
  if (owner && busy) return "Starting...";
  if (owner) return "Start subscription";
  if (busy) return "Confirming payment...";
  return "Subscribe";
}

function SubscriptionAction({
  membership,
  owner,
  busy,
  disabled,
  onAction,
}: {
  membership: CreatorResponse["membership"];
  owner: boolean;
  busy: boolean;
  disabled: boolean;
  onAction: () => void;
}) {
  if (membership.active) return <span className="access-status">Subscribed</span>;
  const canStart = owner ? !membership.offered : membership.offered;
  if (!canStart) return <span className="access-status">Subscription live</span>;
  return (
    <button className="primary" disabled={disabled} onClick={onAction}>
      {subscriptionLabel(owner, busy)}
    </button>
  );
}

function PostCard({ post }: { post: PostResponse }) {
  return (
    <Link to={`/post/${post.id}`} className="post-card">
      <span className={post.canView ? "post-lock unlocked" : "post-lock locked"}>
        <LockIcon open={post.canView} />
        <span className="sr-only">{post.canView ? "Unlocked" : "Locked"}</span>
      </span>
      <div className="post-card-copy">
        <p>{post.caption}</p>
      </div>
      <span className="post-price">{formatKas(post.priceSompi)} KAS</span>
    </Link>
  );
}
