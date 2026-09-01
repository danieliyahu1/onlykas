import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { COPY, type CreatorResponse, type PostResponse } from "@onlykas/shared";
import { api, signPreparedPayment, WalletError } from "./kasware.js";
import { KaspaMark } from "./KaspaMark.js";
import { Icon } from "./Icons.js";
import { useAutoDismiss } from "./useAutoDismiss.js";

type PaymentState =
  "preparing" | "signing" | "confirming" | "pending" | "rejected" | "confirmed";
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
  signIn: () => Promise<string | null>;
  signingIn: boolean;
}) {
  const { id = "" } = useParams();
  const [post, setPost] = useState<PostResponse | null>(null);
  const [error, setError] = useState(false);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [paymentState, setPaymentState] = useState<PaymentState | null>(null);
  const [mediaError, setMediaError] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useAutoDismiss(message, () => setMessage(null));
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
        } else if (recovered.state === "CONFIRMED") {
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
  async function unlock() {
    const buyer = address ?? (await signIn());
    if (!buyer) return;
    setMessage(null);
    setPaymentState("preparing");
    try {
      const prepared = await api<{
        id: string;
        transaction: string;
        amountSompi: string;
      }>(`/api/posts/${currentPost.id}/payments/prepare`, { method: "POST" });
      setPayment(prepared);
      setPaymentState("signing");
      setMessage("Confirm in Kasware.");
      const signed = await signPreparedPayment(prepared.transaction);
      window.localStorage.setItem(
        paymentStorageKey(currentPost.id, buyer),
        prepared.id,
      );
      setPaymentState("confirming");
      setMessage("Opening your post...");
      const result = await api<{ message?: string }>(
        `/api/payments/${prepared.id}/finalize`,
        { method: "POST", body: JSON.stringify({ signedTransaction: signed }) },
      );
      const state = (result as { state?: string }).state;
      if (state === "PENDING") {
        setPaymentState("pending");
        setMessage(COPY.purchasePending);
      } else if (state === "REJECTED") {
        window.localStorage.removeItem(
          paymentStorageKey(currentPost.id, buyer),
        );
        setPaymentState("rejected");
        setMessage(COPY.transactionRejected);
      } else {
        window.localStorage.removeItem(
          paymentStorageKey(currentPost.id, buyer),
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
        window.localStorage.removeItem(
          paymentStorageKey(currentPost.id, buyer),
        );
        setPaymentState("rejected");
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
      {post.canView && !mediaError ? (
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
      ) : (
        <button
          className="primary"
          onClick={() => void unlock()}
          disabled={
            signingIn ||
            paymentState === "preparing" ||
            paymentState === "signing" ||
            paymentState === "confirming" ||
            paymentState === "pending"
          }
        >
          {paymentState === "preparing" ? (
            "Preparing payment..."
          ) : paymentState === "signing" ? (
            "Confirm in Kasware"
          ) : paymentState === "confirming" ? (
            "Opening post..."
          ) : paymentState === "pending" ? (
            "Payment confirming..."
          ) : paymentState === "rejected" ? (
            "Try again"
          ) : (
            <>
              View for <CurrencyAmount sompi={post.priceSompi} />{" "}
              <Icon name="arrow-right" />
            </>
          )}
        </button>
      )}
      {message && (
        <p className="feedback" role="status">
          {message}
        </p>
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
