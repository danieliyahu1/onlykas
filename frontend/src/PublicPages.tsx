import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  COPY,
  type CreatorResponse,
  type MembershipMintAttemptResponse,
  type MembershipOfferResponse,
  type MembershipResponse,
  type PostResponse,
} from "@onlykas/shared";
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

export function CreatorPage({
  wallet,
  signIn,
  signingIn,
}: {
  wallet: string | null;
  signIn: () => Promise<string | null>;
  signingIn: boolean;
}) {
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
  if (error) return <Message title="Profile not found." role="alert" />;
  if (!creator) return <Message title="Opening profile..." role="status" />;
  return (
    <section className="profile">
      <p className="eyebrow">PROFILE</p>
      <h1>{creator.displayName ?? creator.displayAddress}</h1>
      {creator.displayName && (
        <p className="wallet">{creator.displayAddress}</p>
      )}
      <MembershipPanel
        creator={creator.address}
        wallet={wallet}
        signIn={signIn}
        signingIn={signingIn}
      />
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

type MembershipPhase =
  "preparing" | "signing" | "confirming" | "pending" | "rejected";

const membershipStorageKey = (offerId: string, address: string) =>
  `onlykas:mint:${offerId}:${address}`;

function MembershipPanel({
  creator,
  wallet,
  signIn,
  signingIn,
}: {
  creator: string;
  wallet: string | null;
  signIn: () => Promise<string | null>;
  signingIn: boolean;
}) {
  const [offer, setOffer] = useState<MembershipOfferResponse | null>(null);
  const [attempt, setAttempt] = useState<MembershipMintAttemptResponse | null>(
    null,
  );
  const [memberships, setMemberships] = useState<MembershipResponse[]>([]);
  const [phase, setPhase] = useState<MembershipPhase | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useAutoDismiss(message, () => setMessage(null));
  useEffect(() => {
    let active = true;
    void api<{ offer: MembershipOfferResponse | null }>(
      `/api/membership/offers/${encodeURIComponent(creator)}`,
    )
      .then((value) => {
        if (active) setOffer(value.offer);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [creator]);
  const loadMemberships = useCallback(async () => {
    if (!offer || !wallet) {
      setMemberships([]);
      return;
    }
    try {
      const value = await api<{ memberships: MembershipResponse[] }>(
        `/api/membership/offers/${offer.id}/memberships`,
      );
      setMemberships(value.memberships);
    } catch {
      // Membership status load is best-effort.
    }
  }, [offer, wallet]);
  useEffect(() => {
    void loadMemberships();
  }, [loadMemberships]);
  useEffect(() => {
    if (!offer || !wallet) return;
    const key = membershipStorageKey(offer.id, wallet);
    const savedId = window.localStorage.getItem(key);
    if (!savedId) return;
    let active = true;
    void (async () => {
      try {
        const recovered = await api<MembershipMintAttemptResponse>(
          `/api/membership/mints/${savedId}`,
        );
        if (!active) return;
        setAttempt(recovered);
        if (recovered.state === "PENDING") {
          setPhase("pending");
          setMessage(COPY.membershipPending);
        } else if (recovered.state === "CONFIRMED") {
          window.localStorage.removeItem(key);
          await loadMemberships();
        } else {
          window.localStorage.removeItem(key);
        }
      } catch {
        window.localStorage.removeItem(key);
      }
    })();
    return () => {
      active = false;
    };
  }, [offer, wallet, loadMemberships]);
  useEffect(() => {
    if (phase !== "pending" || !attempt || !wallet) return;
    const key = membershipStorageKey(attempt.offerId, wallet);
    const check = async () => {
      try {
        const current = await api<MembershipMintAttemptResponse>(
          `/api/membership/mints/${attempt.id}`,
        );
        if (current.state === "CONFIRMED") {
          window.localStorage.removeItem(key);
          setAttempt(current);
          setPhase(null);
          setMessage(COPY.membershipLive);
          await loadMemberships();
        } else if (current.state === "REJECTED") {
          window.localStorage.removeItem(key);
          setAttempt(current);
          setPhase("rejected");
          setMessage(COPY.membershipRejected);
        }
      } catch {
        setMessage(COPY.accessVerificationFailed);
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 2_000);
    return () => window.clearInterval(timer);
  }, [attempt, loadMemberships, phase, wallet]);
  if (!offer) return null;
  const now = Date.now();
  const live = memberships.find(
    (membership) =>
      membership.state === "ACTIVE" &&
      new Date(membership.validUntil).getTime() > now,
  );
  const lapsed = !live && memberships[0] ? memberships[0] : undefined;
  const price = formatKas(offer.priceSompi);
  async function pay() {
    const buyer = wallet ?? (await signIn());
    if (!buyer || !offer) return;
    setMessage(null);
    setPhase("preparing");
    try {
      const proposed = await api<MembershipMintAttemptResponse>(
        `/api/membership/offers/${offer.id}/mints/propose`,
        { method: "POST" },
      );
      setAttempt(proposed);
      setPhase("signing");
      setMessage(
        COPY.membershipPrompt.replace("{price}", formatKas(offer.priceSompi)),
      );
      const signed = await signPreparedPayment(proposed.transaction!);
      window.localStorage.setItem(
        membershipStorageKey(offer.id, buyer),
        proposed.id,
      );
      setPhase("confirming");
      setMessage(COPY.membershipConfirming);
      const result = await api<MembershipMintAttemptResponse>(
        `/api/membership/mints/${proposed.id}/finalize`,
        { method: "POST", body: JSON.stringify({ signedTransaction: signed }) },
      );
      setAttempt(result);
      if (result.state === "PENDING") {
        setPhase("pending");
        setMessage(COPY.membershipPending);
      } else if (result.state === "REJECTED") {
        window.localStorage.removeItem(membershipStorageKey(offer.id, buyer));
        setPhase("rejected");
        setMessage(COPY.membershipRejected);
      } else {
        window.localStorage.removeItem(membershipStorageKey(offer.id, buyer));
        setPhase(null);
        setMessage(COPY.membershipLive);
        await loadMemberships();
      }
    } catch (caught) {
      const text =
        caught instanceof WalletError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : COPY.membershipRejected;
      setMessage(text);
      if (text === COPY.membershipPending) setPhase("pending");
      else {
        window.localStorage.removeItem(membershipStorageKey(offer.id, buyer));
        setPhase("rejected");
      }
    }
  }
  const busyLabel =
    phase === "preparing"
      ? "Preparing payment..."
      : phase === "signing"
        ? COPY.membershipSigning
        : phase === "confirming"
          ? COPY.membershipConfirming
          : phase === "pending"
            ? COPY.membershipPending
            : null;
  const statusBanner = live
    ? `${COPY.membershipLive} ${COPY.membershipActiveUntil.replace("{date}", formatDate(live.validUntil))}`
    : lapsed
      ? `${COPY.membershipExpired} ${COPY.membershipExpiredOn.replace("{date}", formatDate(lapsed.validUntil))}`
      : null;
  return (
    <aside className="membership-panel">
      <p className="eyebrow">MEMBERSHIP</p>
      <p className="offer-description">{offer.description}</p>
      {statusBanner ? <p className="feedback success">{statusBanner}</p> : null}
      {message && (
        <p className="feedback" role="status">
          {message}
        </p>
      )}
      <p className="price">
        {price} <KaspaMark />
        <span className="sr-only">KAS</span>
      </p>
      <button
        className={live ? "secondary" : "primary"}
        onClick={() => void pay()}
        disabled={
          signingIn ||
          phase === "preparing" ||
          phase === "signing" ||
          phase === "confirming" ||
          phase === "pending"
        }
      >
        {busyLabel ??
          (live ? (
            <>
              {COPY.renewMembershipFor.replace("{price}", price)}{" "}
              <Icon name="arrow-right" />
            </>
          ) : (
            <>
              {COPY.becomeMemberFor.replace("{price}", price)}{" "}
              <Icon name="arrow-right" />
            </>
          ))}
      </button>
    </aside>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
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
      <p className="caption">{post.caption}</p>
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
        By {shorten(post.creator)}
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
