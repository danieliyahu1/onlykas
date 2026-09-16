import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { PostResponse } from "@onlykas/shared";
import { api, signPreparedPayment } from "./kasware.js";
import { Toast, useToast } from "./Toast.js";
import { HomeLink, Message } from "./Message.js";
import { errorText } from "./errors.js";
import { formatKas, shortenAddress } from "./format.js";
import { VideoPlayer } from "./VideoPlayer.js";
import type { WalletProps } from "./wallet.js";

export function PostPage({ address, signIn, signingIn }: WalletProps) {
  const { id = "" } = useParams();
  const [post, setPost] = useState<PostResponse | null>(null);
  const [busy, setBusy] = useState<null | "unlock" | "subscription">(null);
  const [mediaError, setMediaError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { toast, showToast, dismissToast } = useToast();

  useEffect(() => {
    let active = true;
    setPost(null);
    setLoading(true);
    dismissToast();
    setMediaError(false);
    setLoadError(null);
    void (async () => {
      try {
        const value = await api<PostResponse>(`/api/posts/${encodeURIComponent(id)}`);
        if (active) setPost(value);
      } catch (error) {
        if (!active) return;
        setLoadError(errorText(error, "This post isn't available."));
        setPost(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [address, dismissToast, id]);

  if (loading) return <Message title="Loading..." />;
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
      showToast(errorText(error, "Payment failed. Nothing was charged."), "error");
    } finally {
      setBusy(null);
    }
  }

  async function checkSubscription() {
    const buyer = address ?? (await signIn());
    if (!buyer) return;
    setBusy("subscription");
    dismissToast();
    try {
      const refreshed = await api<PostResponse>(
        `/api/posts/${encodeURIComponent(currentPost.id)}`,
      );
      setPost(refreshed);
      if (!refreshed.canView)
        showToast("Your subscription doesn't include this creator.", "error");
    } catch (error) {
      showToast(
        errorText(error, "Couldn't check your subscription. Try again."),
        "error",
      );
    } finally {
      setBusy(null);
    }
  }

  const isVideo = currentPost.mediaType.startsWith("video/");
  const mediaLabel = currentPost.caption || (isVideo ? "Video" : "Photo");
  const mediaUrl = `/api/posts/${encodeURIComponent(currentPost.id)}/media`;
  const isFree = currentPost.priceSompi === "0";

  return (
    <>
      <article className="single-post">
        <h1 className="caption">{currentPost.caption}</h1>
        {currentPost.canView && !mediaError ? (
          address || !isFree ? (
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
          ) : (
            <div className="post-actions">
              <button
                className="primary"
                disabled={busy !== null || signingIn}
                onClick={() => void signIn()}
              >
                Sign in to view
              </button>
            </div>
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
              onClick={() => void checkSubscription()}
            >
              {busy === "subscription"
                ? "Checking subscription..."
                : "Already subscribed?"}
            </button>
          </div>
        )}
        <Link className="creator-link" to={`/creator/${currentPost.creator}`}>
          View creator · {shortenAddress(currentPost.creator)}
        </Link>
      </article>
      <Toast toast={toast} />
    </>
  );
}
