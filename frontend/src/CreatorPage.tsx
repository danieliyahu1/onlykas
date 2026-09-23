import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  isFreePost,
  RETRY_AFTER_REFRESH,
  type CreatorResponse,
  type PostResponse,
} from "@onlykas/shared";
import { api, signPreparedPayment } from "./kasware.js";
import {
  finalizePriceUpdate,
  finalizeCancellation,
  finalizeSubscription,
  preparePriceUpdate,
  prepareCancellation,
  prepareSubscription,
  unlockPost,
} from "./purchase.js";
import { Icon, LockIcon } from "./Icons.js";
import { PostTile, PostTileAction, PostTileMedia } from "./PostTile.js";
import { previewUrl } from "./preview-url.js";
import { PostMedia } from "./PostMedia.js";
import { Spinner } from "./Spinner.js";
import { Toast, useToast } from "./Toast.js";
import { HomeLink, Message } from "./Message.js";
import { COPY } from "./copy.js";
import { errorText } from "./errors.js";
import { ApiError } from "./api-error.js";
import { formatKas, relativeTime, shortenAddress } from "./format.js";
import type { WalletProps } from "./wallet.js";
import {
  creatorAddressFromRoute,
  creatorPath,
  hasAddressPrefix,
} from "./creator-url.js";

type CreatorPageProps = WalletProps & {
  onVisibilityChange?: (isPublic: boolean) => Promise<unknown>;
};

type SubscriptionStage = "preparing" | "confirming" | null;

export function CreatorPage({
  address,
  signIn,
  signingIn,
  onVisibilityChange,
}: CreatorPageProps) {
  const navigate = useNavigate();
  const { address: routeAddress = "" } = useParams();
  const creatorAddress = creatorAddressFromRoute(routeAddress);
  const [creator, setCreator] = useState<CreatorResponse | null>(null);
  const [busy, setBusy] = useState<SubscriptionStage>(null);
  const [membershipPrice, setMembershipPrice] = useState("10");
  const [busyPostId, setBusyPostId] = useState<string | null>(null);
  const [approvedPostId, setApprovedPostId] = useState<string | null>(null);
  const [deletingPostId, setDeletingPostId] = useState<string | null>(null);
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
    }
    setLoadError(null);
    try {
      const value = await api<CreatorResponse>(
        `/api/creators/${encodeURIComponent(creatorAddress)}`,
      );
      if (currentRequest === requestId.current) {
        setCreator(value);
        if (value.membership.priceSompi)
          setMembershipPrice(formatKas(value.membership.priceSompi));
      }
    } catch (error) {
      if (currentRequest !== requestId.current) return;
      const message = errorText(error, "Creator could not be loaded.");
      if (isNewCreator) setLoadError(message);
      else showToast(message, "error");
    } finally {
      if (currentRequest === requestId.current) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    if (hasAddressPrefix(routeAddress)) {
      navigate(creatorPath(creatorAddress), { replace: true });
      return;
    }
    void loadCreator();
  }, [creatorAddress, address, navigate, routeAddress]);

  if (loading)
    return (
      <Message title="Loading..." center>
        <Spinner />
      </Message>
    );
  if (!creator)
    return (
      <Message title={loadError ?? "This creator isn't available."}>
        <HomeLink />
      </Message>
    );

  const currentCreator = creator;
  const owner = currentCreator.isOwner || address === currentCreator.address;
  const showSubscription =
    owner || currentCreator.membership.offered || currentCreator.membership.active ||
    currentCreator.membership.canceled;

  /**
   * One place the membership actions react to a failed request. The server
   * states the semantics with the generic `retry` hint, so this page never has
   * to know a domain code.
   */
  async function handleActionFailure(error: unknown, fallback: string) {
    const refresh = error instanceof ApiError && error.retry === RETRY_AFTER_REFRESH;
    if (refresh) await loadCreator();
    showToast(errorText(error, fallback), refresh ? "info" : "error");
  }

  async function membershipAction() {
    const wallet = address ?? (await signIn());
    if (!wallet) return;
    const actingAsOwner = wallet === currentCreator.address;
    setBusy("preparing");
    dismissToast();
    try {
      const prepared = await prepareSubscription(
        actingAsOwner,
        currentCreator.address,
        actingAsOwner ? membershipPrice : undefined,
      );
      const signedTransaction = await signPreparedPayment(
        prepared.transaction,
        prepared.signInputs,
      );
      setBusy("confirming");
      const result = await finalizeSubscription(
        actingAsOwner,
        prepared.id,
        signedTransaction,
      );
      showToast(
        result.state === "CONFIRMED"
          ? actingAsOwner
            ? "Subscription is ready."
            : "Subscribed for 30 days."
          : "Your payment is confirming. Don't pay again.",
        result.state === "CONFIRMED" ? "success" : "info",
      );
      if (result.state === "CONFIRMED") await loadCreator();
    } catch (error) {
      await handleActionFailure(error, "Payment failed. Nothing was charged.");
    } finally {
      setBusy(null);
    }
  }

  async function updateMembershipPrice() {
    const wallet = address ?? (await signIn());
    if (!wallet || wallet !== currentCreator.address) return;
    setBusy("preparing");
    dismissToast();
    try {
      const prepared = await preparePriceUpdate(membershipPrice);
      const signedTransaction = await signPreparedPayment(
        prepared.transaction,
        prepared.signInputs,
      );
      setBusy("confirming");
      const result = await finalizePriceUpdate(prepared.id, signedTransaction);
      showToast(
        result.state === "CONFIRMED"
          ? "Subscription price updated."
          : "Your update is confirming. Don't repeat it.",
        result.state === "CONFIRMED" ? "success" : "info",
      );
      if (result.state === "CONFIRMED") await loadCreator();
    } catch (error) {
      await handleActionFailure(error, "Price update failed. Nothing was charged.");
    } finally {
      setBusy(null);
    }
  }

  async function cancelMembership() {
    const wallet = address ?? (await signIn());
    if (!wallet || wallet !== currentCreator.address) return;
    if (!window.confirm("Close this subscription permanently? Existing memberships remain valid until expiry, but this cannot be undone.")) return;
    setBusy("preparing");
    dismissToast();
    try {
      const prepared = await prepareCancellation();
      const signedTransaction = await signPreparedPayment(prepared.transaction, prepared.signInputs);
      setBusy("confirming");
      const result = await finalizeCancellation(prepared.id, signedTransaction);
      showToast(
        result.state === "CONFIRMED"
          ? "Subscription closed permanently."
          : "Your cancellation is confirming. Don't repeat it.",
        result.state === "CONFIRMED" ? "success" : "info",
      );
      if (result.state === "CONFIRMED") await loadCreator();
    } catch (error) {
      await handleActionFailure(error, "Cancellation failed. Nothing was charged.");
    } finally {
      setBusy(null);
    }
  }

  async function buyPost(target: PostResponse) {
    const buyer = address ?? (await signIn());
    if (!buyer) return;
    setBusyPostId(target.id);
    setApprovedPostId(null);
    dismissToast();
    try {
      const result = await unlockPost(target.id, () => setApprovedPostId(target.id));
      if (result.state === "CONFIRMED") {
        setCreator((previous) =>
          previous
            ? {
                ...previous,
                posts: previous.posts.map((p) =>
                  p.id === target.id ? { ...p, canView: true } : p,
                ),
              }
            : previous,
        );
        showToast(result.message ?? COPY.unlocked, "success");
      } else {
        showToast(result.message ?? COPY.purchasePending, "info");
      }
    } catch (error) {
      await handleActionFailure(error, "Payment failed. Nothing was charged.");
    } finally {
      setBusyPostId(null);
      setApprovedPostId(null);
    }
  }

  async function deletePost(target: PostResponse) {
    if (!window.confirm("Delete this post and its media? This can't be undone."))
      return;
    setDeletingPostId(target.id);
    dismissToast();
    try {
      await api(`/api/posts/${encodeURIComponent(target.id)}`, {
        method: "DELETE",
      });
      setCreator((previous) =>
        previous
          ? { ...previous, posts: previous.posts.filter((p) => p.id !== target.id) }
          : previous,
      );
      showToast("Post deleted.", "success");
    } catch (error) {
      showToast(errorText(error, "Couldn't delete the post."), "error");
    } finally {
      setDeletingPostId(null);
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
          {owner && onVisibilityChange && currentCreator.posts.length > 0 && (
            <div className="profile-visibility">
              <span>Visibility: {currentCreator.isPublic ? "Public" : "Private"}</span>
              <button
                className="text-button"
                type="button"
                disabled={visibilityBusy}
                onClick={() => void toggleVisibility()}
              >
                {visibilityBusy && <Spinner />}
                {visibilityBusy ? "Saving..." : "Change"}
              </button>
            </div>
          )}
        </div>
        {showSubscription && (
          <div className={owner ? "access-strip is-owner" : "access-strip"}>
            <p className="access-facts">
              Subscription ·{" "}
              {currentCreator.membership.priceSompi
                ? `${formatKas(currentCreator.membership.priceSompi)} KAS · 30 days`
                : "30 days"}
            </p>
            <div className="access-actions">
              <SubscriptionAction
                membership={currentCreator.membership}
                owner={owner}
                stage={busy}
                disabled={busy !== null || signingIn}
                price={membershipPrice}
                onPriceChange={setMembershipPrice}
                onAction={() =>
                  owner && currentCreator.membership.offered
                    ? updateMembershipPrice()
                    : membershipAction()
                }
              />
              {owner && currentCreator.membership.offered && (
                <button
                  className="icon-button danger-icon"
                  type="button"
                  disabled={busy !== null || signingIn}
                  onClick={() => void cancelMembership()}
                  aria-label="Delete subscription"
                  title="Delete subscription"
                >
                  <Icon name="trash" />
                </button>
              )}
            </div>
          </div>
        )}
        <div className="creator-posts">
          {currentCreator.posts.length ? (
            currentCreator.posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                busy={busyPostId === post.id}
                approved={approvedPostId === post.id}
                onBuy={buyPost}
                owner={owner}
                deleting={deletingPostId === post.id}
                onDelete={deletePost}
              />
            ))
          ) : (
            <div className="empty-posts">
              <p>No posts yet.</p>
              {owner && (
                <Link className="secondary" to="/publish">
                  Publish a post
                </Link>
              )}
            </div>
          )}
        </div>
      </section>
      <Toast toast={toast} onDismiss={dismissToast} />
    </>
  );
}

function subscriptionLabel(owner: boolean, stage: SubscriptionStage): string {
  if (stage === "confirming") return "Confirming...";
  if (stage === "preparing") return owner ? "Starting..." : "Preparing...";
  return owner ? "Start subscription" : "Subscribe";
}

function SubscriptionAction({
  membership,
  owner,
  stage,
  disabled,
  price,
  onPriceChange,
  onAction,
}: {
  membership: CreatorResponse["membership"];
  owner: boolean;
  stage: SubscriptionStage;
  disabled: boolean;
  price: string;
  onPriceChange: (value: string) => void;
  onAction: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);

  if (membership.active)
    return (
      <div className="subscription-renewal">
        <span className="access-status">Subscribed</span>
        <button className="secondary" disabled={disabled} onClick={() => void onAction()}>
          {stage !== null && <Spinner />}
          Renew for 30 days
        </button>
      </div>
    );
  if (!owner && membership.canceled)
    return <span className="access-status">Subscription closed</span>;
  if (!owner && !membership.offered)
    return <span className="access-status">Subscription live</span>;
  if (!owner)
    return (
      <button className="primary" disabled={disabled} onClick={() => void onAction()}>
        {stage !== null && <Spinner />}
        {subscriptionLabel(owner, stage)}
      </button>
    );

  const updating = membership.offered;
  const priceField = (
    <span className="price-input subscription-price">
      <input
        inputMode="decimal"
        value={price}
        onChange={(event) => onPriceChange(event.target.value)}
        disabled={disabled}
        aria-label="Monthly subscription price in KAS"
      />
      <span className="price-unit">KAS</span>
    </span>
  );

  if (updating && editing)
    return (
      <div className="subscription-form">
        {priceField}
        <button
          className="icon-button"
          disabled={disabled}
          onClick={() =>
            void onAction().then(() => setEditing(false))
          }
          aria-label="Save price"
          title="Save price"
        >
          {stage !== null ? <Spinner /> : <Icon name="check" />}
        </button>
        <button
          className="icon-button"
          type="button"
          disabled={stage !== null}
          onClick={() => setEditing(false)}
          aria-label="Cancel"
          title="Cancel"
        >
          <span className="icon-button-glyph" aria-hidden="true">
            &times;
          </span>
        </button>
      </div>
    );

  if (updating)
    return (
      <button
        className="icon-button"
        disabled={disabled}
        onClick={() => setEditing(true)}
        aria-label="Update price"
        title="Update price"
      >
        <Icon name="edit" />
      </button>
    );

  return (
    <div className="subscription-form">
      {priceField}
      <button className="primary" disabled={disabled} onClick={() => void onAction()}>
        {stage !== null && <Spinner />}
        {subscriptionLabel(owner, stage)}
      </button>
    </div>
  );
}

function PostCard({
  post,
  busy,
  approved,
  onBuy,
  owner,
  deleting,
  onDelete,
}: {
  post: PostResponse;
  busy: boolean;
  approved: boolean;
  onBuy: (post: PostResponse) => void;
  owner: boolean;
  deleting: boolean;
  onDelete: (post: PostResponse) => void;
}) {
  const free = isFreePost(post.priceSompi);
  const unlocked = free || post.canView;
  const postPath = `/post/${encodeURIComponent(post.id)}`;

  return (
    <PostTile
      media={
        unlocked ? (
          <div className="post-tile-media">
            <PostMedia post={post} />
          </div>
        ) : (
          <PostTileMedia thumbnail={previewUrl(post.id)} to={postPath}>
            <div className="post-tile-locked">
              <LockIcon open={false} />
              <button
                className="buy"
                type="button"
                disabled={busy}
                onClick={() => onBuy(post)}
              >
                {busy && <Spinner />}
                {approved
                  ? "Unlocking..."
                  : busy
                    ? "Approve in wallet..."
                    : `Unlock for ${formatKas(post.priceSompi)} KAS`}
              </button>
            </div>
          </PostTileMedia>
        )
      }
      caption={post.caption}
      date={relativeTime(post.publishedAt)}
      action={
        unlocked ? (
          <PostTileAction>
            <Link className="secondary" to={postPath}>
              {free ? "Watch · Free" : "Watch"}
            </Link>
            {owner && (
              <button
                className="icon-button danger-icon"
                type="button"
                disabled={deleting}
                onClick={() => onDelete(post)}
                aria-label="Delete"
                title="Delete"
              >
                {deleting ? <Spinner /> : <Icon name="trash" />}
              </button>
            )}
          </PostTileAction>
        ) : undefined
      }
    />
  );
}
