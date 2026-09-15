import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link, useParams } from "react-router-dom";
import type { CreatorResponse, PostResponse } from "@onlykas/shared";
import { api, signPreparedPayment, WalletError, ApiError } from "./kasware.js";
import { Toast, useToast } from "./Toast.js";

type WalletProps = {
  address: string | null;
  signIn: () => Promise<string | null>;
  signingIn: boolean;
  onVisibilityChange?: (isPublic: boolean) => Promise<unknown>;
};

export function CreatorPage({
  address,
  signIn,
  signingIn,
  onVisibilityChange,
}: WalletProps) {
  const { address: creatorAddress = "" } = useParams();
  const [creator, setCreator] = useState<CreatorResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const { toast, showToast, dismissToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const requestId = useRef(0);
  async function loadCreator(initial = false) {
    const currentRequest = ++requestId.current;
    if (initial) {
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
      if (currentRequest === requestId.current) {
        setCreator(initial ? null : creator);
        const message =
          error instanceof ApiError ? error.message : "Creator could not be loaded.";
        setLoadError(message);
        if (!initial) showToast(message, "error");
      }
    } finally {
      if (currentRequest === requestId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }
  useEffect(() => {
    void loadCreator(true);
  }, [creatorAddress]);
  if (loading) return <Message title="Loading..." />;
  if (!creator)
    return <Message title={loadError ?? "This creator isn't available."} action />;
  const currentCreator = creator;
  const owner = currentCreator.isOwner || address === currentCreator.address;
  async function membershipAction() {
    const wallet = address ?? (await signIn());
    if (!wallet) return;
    const isOwner = wallet === currentCreator.address;
    setBusy(true);
    dismissToast();
    try {
      const path = isOwner
        ? "/api/membership/offers/prepare"
        : `/api/membership/${encodeURIComponent(currentCreator.address)}/prepare`;
      const prepared = await api<{
        id: string;
        transaction: string;
        signInputs: number[];
      }>(path, { method: "POST" });
      const signedTransaction = await signPreparedPayment(
        prepared.transaction,
        prepared.signInputs,
      );
      const finalizePath = isOwner
        ? `/api/membership/offers/${prepared.id}/finalize`
        : `/api/membership/purchases/${prepared.id}/finalize`;
      const result = await api<{ state: string }>(finalizePath, {
        method: "POST",
        body: JSON.stringify({ signedTransaction }),
      });
      showToast(
        result.state === "CONFIRMED"
          ? isOwner
            ? "24-hour access is ready."
            : "You have access for 24 hours."
          : "Your payment is confirming. Don't pay again.",
        result.state === "CONFIRMED" ? "success" : "info",
      );
      if (result.state === "CONFIRMED") await loadCreator();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Payment failed. Nothing was charged.",
        "error",
      );
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
    try {
      const next = !currentCreator.isPublic;
      await onVisibilityChange(next);
      setCreator({ ...currentCreator, isPublic: next });
      showToast(next ? "Profile is public." : "Profile is private.", "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Couldn't save visibility.",
        "error",
      );
    } finally {
      setVisibilityBusy(false);
    }
  }
  const showAccess =
    owner || currentCreator.membership.offered || currentCreator.membership.active;
  return (
    <>
      <section className="profile">
        <div className="creator-identity">
          <h1 className={currentCreator.displayName ? undefined : "address-heading"}>
            {currentCreator.displayName ?? shorten(currentCreator.address)}
          </h1>
          <button
            className="wallet-address"
            type="button"
            title={currentCreator.address}
            aria-label="Copy Kaspa address"
            onClick={() => void copyAddress()}
          >
            {shorten(currentCreator.address)}
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
        {showAccess && (
          <div className="access-strip">
            <p className="access-facts">Every post for 24 hours · 10 KAS</p>
            {currentCreator.membership.active ? (
              <span className="access-status">Access active</span>
            ) : owner && !currentCreator.membership.offered ? (
              <button
                className="primary"
                disabled={busy || signingIn}
                onClick={() => void membershipAction()}
              >
                {busy ? "Creating offer..." : "Offer 24-hour access"}
              </button>
            ) : !owner && currentCreator.membership.offered ? (
              <button
                className="primary"
                disabled={busy || signingIn}
                onClick={() => void membershipAction()}
              >
                {busy ? "Confirming payment..." : "Unlock every post"}
              </button>
            ) : (
              <span className="access-status">Offer live</span>
            )}
            {refreshing && <span className="access-status">Refreshing...</span>}
          </div>
        )}
        <div className="post-grid">
          {currentCreator.posts.length ? (
            currentCreator.posts.map((post) => <PostCard key={post.id} post={post} />)
          ) : (
            <div className="empty-posts">
              {owner ? (
                <>
                  <p>No posts yet.</p>
                  <Link className="secondary" to="/">
                    Publish a post
                  </Link>
                </>
              ) : (
                <p>No posts yet.</p>
              )}
            </div>
          )}
        </div>
      </section>
      <Toast toast={toast} />
    </>
  );
}

export function PostPage({ address, signIn, signingIn }: WalletProps) {
  const { id = "" } = useParams();
  const [post, setPost] = useState<PostResponse | null>(null);
  const { toast, showToast, dismissToast } = useToast();
  const [busy, setBusy] = useState<null | "unlock" | "membership">(null);
  const [mediaError, setMediaError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setPost(null);
    setLoading(true);
    dismissToast();
    setMediaError(false);
    setLoadError(null);
    void api<PostResponse>(`/api/posts/${encodeURIComponent(id)}`)
      .then((value) => {
        if (!active) return;
        setPost(value);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(error instanceof ApiError ? error.message : null);
        setPost(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [address, dismissToast, id]);
  if (loading) return <Message title="Loading..." />;
  if (!post)
    return <Message title={loadError ?? "This post isn't available."} action />;
  const currentPost = post;
  async function unlock() {
    const buyer = address ?? (await signIn());
    if (!buyer) return;
    setBusy("unlock");
    dismissToast();
    try {
      const prepared = await api<{ id: string; transaction: string }>(
        `/api/posts/${currentPost.id}/payments/prepare`,
        { method: "POST" },
      );
      const signed = await signPreparedPayment(prepared.transaction);
      const result = await api<{ state: string; message?: string }>(
        `/api/payments/${prepared.id}/finalize`,
        { method: "POST", body: JSON.stringify({ signedTransaction: signed }) },
      );
      if (result.state === "CONFIRMED") {
        setPost({ ...currentPost, canView: true });
        showToast(result.message ?? "Unlocked.", "success");
        return;
      }
      showToast(result.message ?? "Your payment is confirming. Don't pay again.");
    } catch (error) {
      showToast(
        error instanceof WalletError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Payment failed. Nothing was charged.",
        "error",
      );
    } finally {
      setBusy(null);
    }
  }
  async function useMembership() {
    const buyer = address ?? (await signIn());
    if (!buyer) return;
    setBusy("membership");
    dismissToast();
    try {
      const refreshed = await api<PostResponse>(
        `/api/posts/${encodeURIComponent(currentPost.id)}`,
      );
      setPost(refreshed);
      if (!refreshed.canView)
        showToast("Your access doesn't include this creator.", "error");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Couldn't check access. Try again.",
        "error",
      );
    } finally {
      setBusy(null);
    }
  }
  const mediaLabel = currentPost.mediaType.startsWith("video/") ? "Video" : "Photo";
  return (
    <>
      <article className="single-post">
        <h1 className="caption">{currentPost.caption}</h1>
        {currentPost.canView && !mediaError ? (
          currentPost.mediaType.startsWith("video/") ? (
            <VideoPlayer
              src={`/api/posts/${encodeURIComponent(currentPost.id)}/media`}
              label={currentPost.caption || mediaLabel}
              onError={() => setMediaError(true)}
            />
          ) : (
            <img
              className="post-media"
              src={`/api/posts/${encodeURIComponent(currentPost.id)}/media`}
              alt={currentPost.caption || mediaLabel}
              onError={() => setMediaError(true)}
            />
          )
        ) : mediaError ? (
          <p className="feedback inline" role="alert">
            This media isn&apos;t available right now.
          </p>
        ) : (
          <div className="post-actions">
            <button
              className="primary"
              disabled={busy !== null || signingIn}
              onClick={() => void unlock()}
            >
              {busy === "unlock"
                ? "Unlocking..."
                : `Unlock for ${formatKas(currentPost.priceSompi)} KAS`}
            </button>
            <button
              className="secondary"
              disabled={busy !== null || signingIn}
              onClick={() => void useMembership()}
            >
              {busy === "membership" ? "Checking access..." : "Already have access?"}
            </button>
          </div>
        )}
        <Link className="creator-link" to={`/creator/${currentPost.creator}`}>
          View creator · {shorten(currentPost.creator)}
        </Link>
      </article>
      <Toast toast={toast} />
    </>
  );
}

function PostCard({ post }: { post: PostResponse }) {
  const state = post.canView ? "Unlocked" : "Locked";
  return (
    <Link to={`/post/${post.id}`} className="post-card">
      <span className={post.canView ? "post-lock unlocked" : "post-lock locked"}>
        <LockIcon open={post.canView} />
        <span className="sr-only">{state}</span>
      </span>
      <div className="post-card-copy">
        <p>{post.caption}</p>
      </div>
      <span className="post-price">{formatKas(post.priceSompi)} KAS</span>
    </Link>
  );
}

function LockIcon({ open }: { open: boolean }) {
  return (
    <svg className="post-lock-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 11h14v9H5z" />
      {open ? (
        <path d="M8 11V7a4 4 0 0 1 7.7-1.5" />
      ) : (
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      )}
    </svg>
  );
}

function VideoPlayer({
  src,
  label,
  onError,
}: {
  src: string;
  label: string;
  onError: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  function togglePlayback() {
    if (!video.current) return;
    if (video.current.paused) void video.current.play();
    else video.current.pause();
  }
  function seek(value: number) {
    if (!video.current) return;
    video.current.currentTime = value;
    setCurrentTime(value);
  }
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === " " || event.key.toLowerCase() === "k") {
      event.preventDefault();
      togglePlayback();
    } else if (event.key === "ArrowLeft") seek(Math.max(0, currentTime - 5));
    else if (event.key === "ArrowRight") seek(Math.min(duration, currentTime + 5));
    else if (event.key.toLowerCase() === "m" && video.current) {
      video.current.muted = !video.current.muted;
      setMuted(video.current.muted);
    } else if (event.key.toLowerCase() === "f") void video.current?.requestFullscreen();
  }
  return (
    <div
      className="video-player"
      tabIndex={0}
      role="group"
      aria-label={`${label} video`}
      onKeyDown={handleKeyDown}
    >
      <video
        ref={video}
        src={src}
        playsInline
        preload="metadata"
        onClick={togglePlayback}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onError={onError}
      />
      {!playing && (
        <button
          className="video-play"
          type="button"
          aria-label="Play video"
          title="Play"
          onClick={togglePlayback}
        >
          <VideoIcon name="play" />
        </button>
      )}
      <div className="video-controls">
        <button
          type="button"
          onClick={togglePlayback}
          aria-label={playing ? "Pause video" : "Play video"}
          title={playing ? "Pause" : "Play"}
        >
          <VideoIcon name={playing ? "pause" : "play"} />
        </button>
        <input
          type="range"
          min="0"
          max={duration || 0}
          step="0.1"
          value={currentTime}
          aria-label="Video progress"
          onChange={(event) => seek(Number(event.target.value))}
        />
        <span className="video-time">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
        <button
          type="button"
          onClick={() => {
            if (video.current) video.current.muted = !video.current.muted;
            setMuted(!muted);
          }}
          aria-label={muted ? "Unmute video" : "Mute video"}
          title={muted ? "Unmute" : "Mute"}
        >
          <VideoIcon name={muted ? "unmute" : "mute"} />
        </button>
        <button
          type="button"
          onClick={() => void video.current?.requestFullscreen()}
          aria-label="Fullscreen video"
          title="Fullscreen"
        >
          <VideoIcon name="fullscreen" />
        </button>
      </div>
    </div>
  );
}

function VideoIcon({
  name,
}: {
  name: "fullscreen" | "mute" | "pause" | "play" | "unmute";
}) {
  const paths = {
    fullscreen: (
      <>
        <path d="M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6" />
      </>
    ),
    mute: (
      <>
        <path d="M3 10v4h4l5 4V6l-5 4H3M16 9l5 6M21 9l-5 6" />
      </>
    ),
    pause: (
      <>
        <path d="M7 4v16M17 4v16" />
      </>
    ),
    play: <path d="m8 5 11 7-11 7V5Z" fill="currentColor" stroke="none" />,
    unmute: (
      <>
        <path d="M3 10v4h4l5 4V6l-5 4H3M16 9c2 2 2 4 0 6M19 6c4 4 4 8 0 12" />
      </>
    ),
  };
  return (
    <svg className="video-icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function Message({ title, action }: { title: string; action?: boolean }) {
  return (
    <section className="message">
      <h1 className="message-title">{title}</h1>
      {action && (
        <Link className="secondary" to="/">
          Go home
        </Link>
      )}
    </section>
  );
}
function formatKas(sompi: string) {
  const padded = BigInt(sompi).toString().padStart(9, "0");
  return `${padded.slice(0, -8)}.${padded.slice(-8)}`.replace(/\.?0+$/, "");
}
function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}
function shorten(address: string) {
  return `${address.slice(0, 16)}...${address.slice(-8)}`;
}
