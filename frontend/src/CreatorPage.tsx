import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  isFreePost,
  isVideoMedia,
  type CreatorResponse,
  type PostResponse,
} from "@onlykas/shared";
import { api, signPreparedPayment } from "./kasware.js";
import { finalizeSubscription, prepareSubscription, unlockPost } from "./purchase.js";
import { PostTile, PostTileAction, PostTileMedia } from "./PostTile.js";
import { Spinner } from "./Spinner.js";
import { Toast, useToast } from "./Toast.js";
import { HomeLink, Message } from "./Message.js";
import { COPY } from "./copy.js";
import { errorText } from "./errors.js";
import { formatKas, relativeTime, shortenAddress } from "./format.js";
import type { WalletProps } from "./wallet.js";
import {
  creatorAddressFromRoute,
  creatorPath,
  hasTestnetPrefix,
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
      if (currentRequest === requestId.current) setCreator(value);
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
    if (hasTestnetPrefix(routeAddress)) {
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
    owner || currentCreator.membership.offered || currentCreator.membership.active;

  async function membershipAction() {
    const wallet = address ?? (await signIn());
    if (!wallet) return;
    const actingAsOwner = wallet === currentCreator.address;
    setBusy("preparing");
    dismissToast();
    try {
      const prepared = await prepareSubscription(actingAsOwner, currentCreator.address);
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
            : "Subscribed for 24 hours."
          : "Your payment is confirming. Don't pay again.",
        result.state === "CONFIRMED" ? "success" : "info",
      );
      if (result.state === "CONFIRMED") await loadCreator();
    } catch (error) {
      showToast(errorText(error, "Payment failed. Nothing was charged."), "error");
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
      showToast(errorText(error, "Payment failed. Nothing was charged."), "error");
    } finally {
      setBusyPostId(null);
      setApprovedPostId(null);
    }
  }

  async function deletePost(target: PostResponse) {
    if (
      !window.confirm("Delete this post and its media? This can't be undone.")
    )
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
          {owner && onVisibilityChange && (
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
          <div className="access-strip">
            <p className="access-facts">{COPY.membershipAccess}</p>
            <SubscriptionAction
              membership={currentCreator.membership}
              owner={owner}
              stage={busy}
              disabled={busy !== null || signingIn}
              onAction={() => void membershipAction()}
            />
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
  onAction,
}: {
  membership: CreatorResponse["membership"];
  owner: boolean;
  stage: SubscriptionStage;
  disabled: boolean;
  onAction: () => void;
}) {
  if (membership.active) return <span className="access-status">Subscribed</span>;
  const canStart = owner ? !membership.offered : membership.offered;
  if (!canStart) return <span className="access-status">Subscription live</span>;
  return (
    <button className="primary" disabled={disabled} onClick={onAction}>
      {stage !== null && <Spinner />}
      {subscriptionLabel(owner, stage)}
    </button>
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
  const isVideo = isVideoMedia(post.mediaType);
  const mediaUrl = `/api/posts/${encodeURIComponent(post.id)}/media`;

  return (
    <PostTile
      media={
        <PostTileMedia
          thumbnail={unlocked && !isVideo ? mediaUrl : undefined}
          overlay={!unlocked ? "locked" : isVideo ? "video" : "none"}
          to={`/post/${encodeURIComponent(post.id)}`}
        />
      }
      caption={post.caption}
      date={relativeTime(post.publishedAt)}
      action={
        <PostTileAction>
          {unlocked ? (
            <Link className="secondary" to={`/post/${post.id}`}>
              {free ? "Watch · Free" : "Watch"}
            </Link>
          ) : (
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
                  : `Unlock · ${formatKas(post.priceSompi)} KAS`}
            </button>
          )}
          {owner && (
            <button
              className="delete-post"
              type="button"
              disabled={deleting}
              onClick={() => onDelete(post)}
            >
              {deleting && <Spinner />}
              {deleting ? "Deleting..." : "Delete"}
            </button>
          )}
        </PostTileAction>
      }
    />
  );
}
