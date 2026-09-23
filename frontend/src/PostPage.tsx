import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { type PostResponse } from "@onlykas/shared";
import { api } from "./kasware.js";
import { unlockPost } from "./purchase.js";
import { Toast, useToast } from "./Toast.js";
import { Spinner } from "./Spinner.js";
import { LockIcon } from "./Icons.js";
import { HomeLink, Message } from "./Message.js";
import { errorText } from "./errors.js";
import { formatKas, shortenAddress } from "./format.js";
import { PostMedia } from "./PostMedia.js";
import type { WalletProps } from "./wallet.js";
import { creatorPath } from "./creator-url.js";

export function PostPage({ address, signIn, signingIn }: WalletProps) {
  const { id = "" } = useParams();
  const location = useLocation();
  const [post, setPost] = useState<PostResponse | null>(null);
  const [busy, setBusy] = useState<null | "approval" | "unlock">(null);
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
    setBusy("approval");
    dismissToast();
    try {
      const result = await unlockPost(currentPost.id, () => setBusy("unlock"));
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

  return (
    <>
      <article className="single-post">
        {currentPost.caption && (
          <h1 className="caption">{currentPost.caption}</h1>
        )}
        <div className="post-stage">
          {currentPost.canView ? (
            <PostMedia key={currentPost.id} post={currentPost} />
          ) : (
            <div className="post-locked">
              <LockIcon open={false} />
              <button
                className="buy"
                disabled={busy !== null || signingIn}
                onClick={() => void unlock()}
              >
                {busy && <Spinner />}
                {busy === "unlock"
                  ? "Unlocking..."
                  : busy === "approval"
                    ? "Approve in wallet..."
                    : `Unlock for ${formatKas(currentPost.priceSompi)} KAS`}
              </button>
            </div>
          )}
        </div>
        <Link className="creator-link" to={creatorPath(currentPost.creator)}>
          View creator · {shortenAddress(currentPost.creator)}
        </Link>
      </article>
      <Toast toast={toast} onDismiss={dismissToast} />
    </>
  );
}
