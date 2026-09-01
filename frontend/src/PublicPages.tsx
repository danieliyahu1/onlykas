import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { COPY, type CreatorResponse, type PostResponse } from "@onlykas/shared";
import { api, signPreparedPayment, WalletError } from "./kasware.js";
import { KaspaMark } from "./KaspaMark.js";

type PaymentState =
  | "preparing"
  | "ready"
  | "signing"
  | "confirming"
  | "pending"
  | "rejected"
  | "confirmed";
type Payment = {
  id: string;
  transaction?: string;
  amountSompi: string;
  state?: string;
};

const paymentStorageKey = (postId: string, address: string) =>
  `onlykas:payment:${postId}:${address}`;

export function CreatorPage() {
  const { address = "" } = useParams();
  const [creator, setCreator] = useState<CreatorResponse | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    setCreator(null);
    setError(false);
    void api<CreatorResponse>(`/api/creators/${encodeURIComponent(address)}`)
      .then((value) => {
        if (active) setCreator(value);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [address]);
  if (error) return <Message title="Creator not found." role="alert" />;
  if (!creator) return <Message title="Opening profile..." role="status" />;
  return (
    <section className="profile">
      <p className="eyebrow">CREATOR</p>
      <h1>{creator.displayName ?? creator.displayAddress}</h1>
      {creator.displayName && (
        <p className="wallet">{creator.displayAddress}</p>
      )}
      {creator.posts.length === 0 ? (
        <p role="status">Nothing published yet.</p>
      ) : (
        <div className="post-grid">
          {creator.posts.map((post, index) => (
            <PostCard key={post.id} post={post} index={index} />
          ))}
        </div>
      )}
    </section>
  );
}

export function PostPage({
  address,
  signIn,
  signingIn,
}: {
  address: string | null;
  signIn: () => Promise<void>;
  signingIn: boolean;
}) {
  const { id = "" } = useParams();
  const [post, setPost] = useState<PostResponse | null>(null);
  const [error, setError] = useState(false);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [paymentState, setPaymentState] = useState<PaymentState | null>(null);
  const [mediaError, setMediaError] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [unlockAfterSignIn, setUnlockAfterSignIn] = useState(false);
  useEffect(() => {
    let active = true;
    setPost(null);
    setError(false);
    void api<PostResponse>(`/api/posts/${id}`)
      .then((value) => {
        if (active) setPost(value);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [id]);
  useEffect(() => {
    setPayment(null);
    setPaymentState(null);
    setMediaError(false);
    setMessage(null);
  }, [address, id]);
  useEffect(() => {
    if (!address || !post || !unlockAfterSignIn) return;
    setUnlockAfterSignIn(false);
    void prepare();
  }, [address, post, unlockAfterSignIn]);
  useEffect(() => {
    if (!address || !post) return;
    const key = paymentStorageKey(post.id, address);
    const savedId = window.localStorage.getItem(key);
    if (!savedId) return;
    let active = true;
    const recover = async () => {
      try {
        const recovered = await api<Payment>(`/api/payments/${savedId}`);
        if (!active) return;
        setPayment(recovered);
        if (recovered.state === "PENDING") {
          setPaymentState("pending");
          setMessage(COPY.purchasePending);
        } else if (recovered.state === "PREPARED" && recovered.transaction)
          setPaymentState("ready");
        else if (recovered.state === "CONFIRMED") {
          window.localStorage.removeItem(key);
          setPaymentState("confirmed");
          setPost((value) => (value ? { ...value, canView: true } : value));
        } else {
          window.localStorage.removeItem(key);
        }
      } catch {
        window.localStorage.removeItem(key);
      }
    };
    void recover();
    return () => {
      active = false;
    };
  }, [address, post]);
  useEffect(() => {
    if (!address || !post || paymentState !== "pending" || !payment) return;
    const key = paymentStorageKey(post.id, address);
    const check = async () => {
      try {
        const current = await api<Payment>(`/api/payments/${payment.id}`);
        if (current.state === "CONFIRMED") {
          window.localStorage.removeItem(key);
          setPayment(current);
          setPaymentState("confirmed");
          setPost((value) => (value ? { ...value, canView: true } : value));
        } else if (current.state === "REJECTED") {
          window.localStorage.removeItem(key);
          setPayment(current);
          setPaymentState("rejected");
          setMessage(COPY.transactionRejected);
        }
      } catch {
        setMessage(COPY.accessVerificationFailed);
      }
    };
    const timer = window.setInterval(() => void check(), 2_000);
    return () => window.clearInterval(timer);
  }, [address, payment, paymentState, post]);
  useEffect(() => {
    let wallet;
    try {
      wallet = window.kasware;
    } catch {
      return;
    }
    if (!wallet) return;
    const reset = () => {
      if (address && post) {
        window.localStorage.removeItem(paymentStorageKey(post.id, address));
      }
      setPayment(null);
      setPaymentState(null);
      setMessage(COPY.walletCancelled);
    };
    wallet.on("accountsChanged", reset);
    wallet.on("networkChanged", reset);
    return () => {
      wallet.removeListener("accountsChanged", reset);
      wallet.removeListener("networkChanged", reset);
    };
  }, [address, post]);
  if (error) return <Message title="Post not found." role="alert" />;
  if (!post) return <Message title="Opening post..." role="status" />;
  const currentPost = post;
  async function prepare() {
    if (!address) {
      setUnlockAfterSignIn(true);
      return signIn();
    }
    setMessage(null);
    setPaymentState("preparing");
    try {
      const prepared = await api<{
        id: string;
        transaction: string;
        amountSompi: string;
      }>(`/api/posts/${currentPost.id}/payments/prepare`, { method: "POST" });
      setPayment(prepared);
      setPaymentState("ready");
      window.localStorage.setItem(
        paymentStorageKey(currentPost.id, address),
        prepared.id,
      );
    } catch (caught) {
      setPaymentState(null);
      setMessage(
        caught instanceof Error
          ? caught.message
          : COPY.accessVerificationFailed,
      );
    }
  }
  async function pay() {
    if (!payment?.transaction || paymentState !== "ready") return;
    setPaymentState("signing");
    setMessage(null);
    try {
      const signed = await signPreparedPayment(payment.transaction);
      setPaymentState("confirming");
      setMessage(COPY.confirmingPayment);
      const result = await api<{ message?: string }>(
        `/api/payments/${payment.id}/finalize`,
        { method: "POST", body: JSON.stringify({ signedTransaction: signed }) },
      );
      const state = (result as { state?: string }).state;
      if (state === "PENDING") {
        setPaymentState("pending");
        setMessage(COPY.purchasePending);
      } else if (state === "REJECTED") {
        setPaymentState("rejected");
        setMessage(COPY.transactionRejected);
      } else {
        window.localStorage.removeItem(
          paymentStorageKey(currentPost.id, address ?? ""),
        );
        setPaymentState("confirmed");
        setMessage(COPY.unlocked);
        setPost((value) => (value ? { ...value, canView: true } : value));
      }
    } catch (caught) {
      const text =
        caught instanceof WalletError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : COPY.transactionRejected;
      setMessage(text);
      if (text === COPY.purchasePending) setPaymentState("pending");
      else {
        setPaymentState("rejected");
        setMessage(COPY.transactionRejected);
      }
    }
  }
  return (
    <article className="single-post">
      <p className="eyebrow">PRIVATE RELEASE</p>
      <h1>{post.title}</h1>
      <p className="description">{post.description}</p>
      <p className="price">
        <CurrencyAmount sompi={post.priceSompi} />
      </p>
      {post.canView && paymentState !== "confirmed" && !mediaError ? (
        post.mediaType.startsWith("video/") ? (
          <video
            src={`/api/posts/${post.id}/media`}
            controls
            aria-label={`Video: ${post.title}`}
            onError={() => setMediaError(true)}
          />
        ) : (
          <img
            src={`/api/posts/${post.id}/media`}
            alt={post.title}
            onError={() => setMediaError(true)}
          />
        )
      ) : mediaError ? (
        <p className="feedback" role="alert">
          {COPY.mediaUnavailable}
        </p>
      ) : post.canView && paymentState === "confirmed" ? (
        post.mediaType.startsWith("video/") ? (
          <video
            src={`/api/posts/${post.id}/media`}
            controls
            aria-label={`Video: ${post.title}`}
            onError={() => setMediaError(true)}
          />
        ) : (
          <img
            src={`/api/posts/${post.id}/media`}
            alt={post.title}
            onError={() => setMediaError(true)}
          />
        )
      ) : (
        <button
          className="primary"
          onClick={() => void prepare()}
          disabled={
            signingIn ||
            paymentState === "preparing" ||
            paymentState === "confirming" ||
            paymentState === "pending"
          }
        >
          Unlock for <CurrencyAmount sompi={post.priceSompi} />
        </button>
      )}
      {message && (
        <p className="feedback" role="status">
          {message}
        </p>
      )}
      {payment && paymentState && paymentState !== "confirmed" && (
        <div className="dialog-backdrop" role="presentation">
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="unlock-title"
            aria-describedby="unlock-description"
          >
            <p className="eyebrow">UNLOCK</p>
            <h2 id="unlock-title">Unlock this post?</h2>
            <p id="unlock-description">
              {COPY.unlockPrompt.replace(
                "{price}",
                formatKas(payment.amountSompi),
              )}
            </p>
            <div className="dialog-actions">
              <button
                className="primary"
                disabled={paymentState !== "ready"}
                onClick={() => void pay()}
              >
                {paymentState === "rejected"
                  ? "Payment rejected"
                  : paymentState === "pending"
                    ? "Pending"
                    : paymentState === "signing"
                      ? "Approve in Kasware"
                      : paymentState === "confirming"
                        ? COPY.confirmingPayment
                        : `Pay ${formatKas(payment.amountSompi)}`}
                {paymentState === "ready" && (
                  <>
                    <KaspaMark />
                    <span className="sr-only"> KAS</span>
                  </>
                )}
              </button>
              {paymentState === "rejected" && (
                <button className="secondary" onClick={() => void prepare()}>
                  Retry payment
                </button>
              )}
              <button
                className="secondary"
                disabled={
                  paymentState === "signing" ||
                  paymentState === "confirming" ||
                  paymentState === "pending"
                }
                onClick={() => {
                  setPayment(null);
                  setPaymentState(null);
                  if (address)
                    window.localStorage.removeItem(
                      paymentStorageKey(currentPost.id, address),
                    );
                  setMessage(COPY.paymentCancelled);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      <Link className="creator-link" to={`/creator/${post.creator}`}>
        Created by {shorten(post.creator)}
      </Link>
    </article>
  );
}

function PostCard({ post, index }: { post: PostResponse; index: number }) {
  return (
    <Link to={`/post/${post.id}`} className="post-card">
      <span className="index">{String(index + 1).padStart(2, "0")}</span>
      <div>
        <p>
          {post.mediaType.startsWith("video/") ? "VIDEO" : "IMAGE"} ·{" "}
          {new Date(post.publishedAt).toLocaleDateString()}
        </p>
        <h2>{post.title}</h2>
        <span>
          {post.canView ? (
            "View"
          ) : (
            <>
              Unlock for <CurrencyAmount sompi={post.priceSompi} />
            </>
          )}
        </span>
      </div>
    </Link>
  );
}
function Message({ title, role }: { title: string; role: "alert" | "status" }) {
  return (
    <section className="message" role={role}>
      <p className="eyebrow">ONLYKAS</p>
      <h1>{title}</h1>
    </section>
  );
}
function formatKas(sompi: string) {
  const padded = BigInt(sompi).toString().padStart(9, "0");
  return `${padded.slice(0, -8)}.${padded.slice(-8)}`.replace(/\.?0+$/, "");
}
function CurrencyAmount({ sompi }: { sompi: string }) {
  return (
    <>
      <span>{formatKas(sompi)}</span> <KaspaMark />
      <span className="sr-only">KAS</span>
    </>
  );
}
function shorten(address: string) {
  return `${address.slice(0, 16)}...${address.slice(-8)}`;
}
