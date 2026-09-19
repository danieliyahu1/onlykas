import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { isVideoMedia, type PostResponse } from "@onlykas/shared";
import { api } from "./kasware.js";
import { unlockPost } from "./purchase.js";
import { Toast, useToast } from "./Toast.js";
import { Spinner } from "./Spinner.js";
import { HomeLink, Message } from "./Message.js";
import { errorText } from "./errors.js";
import { formatKas, shortenAddress } from "./format.js";
import { VideoPlayer } from "./VideoPlayer.js";
import type { WalletProps } from "./wallet.js";

export function PostPage({ address, signIn, signingIn }: WalletProps) {
  const { id = "" } = useParams();
  const location = useLocation();
  const [post, setPost] = useState<PostResponse | null>(null);
  const [busy, setBusy] = useState<null | "unlock">(null);
  const [mediaError, setMediaError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { toast, showToast, dismissToast } = useToast();
  const notice = (location.state as { notice?: string } | null)?.notice;
  const shownNotice = useRef(false);

  const loadPost = useCallback(async () => {
    try {
      const value = await api<PostResponse>(`/api/posts/${encodeURIComponent(id)}`);
      setPost(value);
      setLoadError(null);
    } catch (error) {
      setLoadError(errorText(error, "This post isn't available."));
      setPost(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setPost(null);
    setLoading(true);
    setMediaError(false);
    setLoadError(null);
    void loadPost();
  }, [address, loadPost]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void loadPost();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadPost]);

  useEffect(() => {
    if (!notice || shownNotice.current) return;
    shownNotice.current = true;
    showToast(notice, "notice");
  }, [notice, showToast]);

  if (loading)
    return (
      <Message title="Loading..." center>
        <Spinner />
      </Message>
    );
  if (!post)
    return (
      <Message title={loadError ?? "This post isn't available."}>
        <HomeLink />
      </Message>
    );

  const currentPost = post;

  async function unlock() {
    const buyer = address ?? (await signIn());
    if (!buyer) return;
    setBusy("unlock");
    dismissToast();
    try {
      const result = await unlockPost(currentPost.id);
      if (result.state === "CONFIRMED") {
        setPost({ ...currentPost, canView: true });
        showToast(result.message ?? "Unlocked.", "success");
        return;
      }
      showToast(result.message ?? "Your payment is confirming. Don't pay again.");
    } catch (error) {
      showToast(errorText(error, "Payment failed. Nothing was charged."), "error");
    } finally {
      setBusy(null);
    }
  }

  const isVideo = isVideoMedia(currentPost.mediaType);
  const mediaLabel = currentPost.caption || (isVideo ? "Video" : "Photo");
  const mediaUrl = `/api/posts/${encodeURIComponent(currentPost.id)}/media`;

  return (
    <>
      <article className="single-post">
        <h1 className="caption">{currentPost.caption}</h1>
        {currentPost.canView && !mediaError ? (
          isVideo ? (
            <VideoPlayer
              src={mediaUrl}
              label={mediaLabel}
              onError={() => setMediaError(true)}
            />
          ) : (
            <img
              className="post-media"
              src={mediaUrl}
              alt={mediaLabel}
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
              className="buy"
              disabled={busy !== null || signingIn}
              onClick={() => void unlock()}
            >
              {busy === "unlock" && <Spinner />}
              {busy === "unlock"
                ? "Unlocking..."
                : `Unlock for ${formatKas(currentPost.priceSompi)} KAS`}
            </button>
          </div>
        )}
        <Link className="creator-link" to={`/creator/${currentPost.creator}`}>
          View creator · {shortenAddress(currentPost.creator)}
        </Link>
      </article>
      <Toast toast={toast} onDismiss={dismissToast} />
    </>
  );
}
