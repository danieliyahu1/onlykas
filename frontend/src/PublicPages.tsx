import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { CreatorResponse, PostResponse } from "@onlykas/shared";
import { api, signPreparedPayment, WalletError } from "./kasware.js";
import { KaspaMark } from "./KaspaMark.js";

type WalletProps = { address: string | null; signIn: () => Promise<string | null>; signingIn: boolean };

export function CreatorPage({ address, signIn, signingIn }: WalletProps) {
  const { address: creatorAddress = "" } = useParams();
  const [creator, setCreator] = useState<CreatorResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function loadCreator() { setCreator(await api<CreatorResponse>(`/api/creators/${encodeURIComponent(creatorAddress)}`)); }
  useEffect(() => { void loadCreator().catch(() => setCreator(null)); }, [creatorAddress]);
  if (!creator) return <Message title="Creator unavailable." />;
  const currentCreator = creator;
  const owner = currentCreator.isOwner || address === currentCreator.address;
  async function membershipAction() {
    const wallet = address ?? (await signIn());
    if (!wallet) return;
    const isOwner = wallet === currentCreator.address;
    setBusy(true); setMessage(null);
    try {
      const path = isOwner ? "/api/membership/offers/prepare" : `/api/membership/${encodeURIComponent(currentCreator.address)}/prepare`;
      const prepared = await api<{ id: string; transaction: string; signInputs: number[] }>(path, { method: "POST" });
      const signedTransaction = await signPreparedPayment(prepared.transaction, prepared.signInputs);
      const finalizePath = isOwner ? `/api/membership/offers/${prepared.id}/finalize` : `/api/membership/purchases/${prepared.id}/finalize`;
      const result = await api<{ state: string }>(finalizePath, { method: "POST", body: JSON.stringify({ signedTransaction }) });
      setMessage(result.state === "CONFIRMED" ? isOwner ? "Membership offer created." : "Membership active for 24 hours." : "Transaction is still confirming.");
      if (result.state === "CONFIRMED") await loadCreator();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Membership transaction failed.");
    } finally { setBusy(false); }
  }
  return <section className="profile"><p className="eyebrow">CREATOR</p><h1>{creator.displayName ?? creator.displayAddress}</h1><div className="membership-panel"><p className="membership-note">One membership unlocks every post from this creator for 24 hours.</p>{creator.membership.active ? <span className="member-pill">Member</span> : owner && !creator.membership.offered ? <button className="primary" disabled={busy || signingIn} onClick={() => void membershipAction()}>{busy ? "Creating offer..." : "Create membership offer"}</button> : !owner && creator.membership.offered ? <button className="primary" disabled={busy || signingIn} onClick={() => void membershipAction()}>{busy ? "Confirming membership..." : "Become a member for 1 KAS"}</button> : owner ? <span className="member-pill">Offer active</span> : <p className="membership-note">Memberships are not available yet. The creator must create an offer first.</p>}{message && <p className="feedback" role="status">{message}</p>}</div><div className="post-grid">{creator.posts.map((post) => <PostCard key={post.id} post={post} />)}</div></section>;
}

export function PostPage({ address, signIn, signingIn }: WalletProps) {
  const { id = "" } = useParams();
  const [post, setPost] = useState<PostResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  useEffect(() => { setPost(null); setMessage(null); void api<PostResponse>(`/api/posts/${encodeURIComponent(id)}`).then(setPost).catch(() => setPost(null)); }, [id]);
  if (!post) return <Message title="Post unavailable." />;
  const currentPost = post;
  async function unlock() {
    const buyer = address ?? (await signIn());
    if (!buyer) return;
    setBusy(true); setMessage(null);
    try {
      const prepared = await api<{ id: string; transaction: string }>(`/api/posts/${currentPost.id}/payments/prepare`, { method: "POST" });
      const signed = await signPreparedPayment(prepared.transaction);
      const result = await api<{ state: string; message?: string }>(`/api/payments/${prepared.id}/finalize`, { method: "POST", body: JSON.stringify({ signedTransaction: signed }) });
      setMessage(result.message ?? "Post unlocked.");
      if (result.state === "CONFIRMED") setPost({ ...currentPost, canView: true });
      if (result.state === "PENDING") setMessage("Payment is still confirming. Try again shortly.");
    } catch (error) {
      setMessage(error instanceof WalletError ? error.message : error instanceof Error ? error.message : "Payment could not be completed.");
    } finally { setBusy(false); }
  }
  async function useMembership() {
    const buyer = address ?? (await signIn());
    if (!buyer) return;
    setBusy(true); setMessage(null);
    try {
      const refreshed = await api<PostResponse>(`/api/posts/${encodeURIComponent(currentPost.id)}`);
      setPost(refreshed);
      if (!refreshed.canView) setMessage("You are not a member of this creator.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Membership could not be checked.");
    } finally { setBusy(false); }
  }
  return <article className="single-post"><p className="eyebrow">PRIVATE POST</p><h1>{currentPost.title}</h1><p className="caption">{currentPost.caption}</p>{currentPost.canView && !mediaError ? currentPost.mediaType.startsWith("video/") ? <video className="post-media" src={`/api/posts/${encodeURIComponent(currentPost.id)}/media`} controls onError={() => setMediaError(true)} /> : <img className="post-media" src={`/api/posts/${encodeURIComponent(currentPost.id)}/media`} alt={currentPost.title} onError={() => setMediaError(true)} /> : mediaError ? <p className="feedback" role="alert">Media is temporarily unavailable.</p> : <div className="post-actions"><button className="primary" disabled={busy || signingIn} onClick={() => void unlock()}>{busy ? "Working..." : <>Unlock for {formatKas(currentPost.priceSompi)} <KaspaMark /></>}</button><button className="secondary" disabled={busy || signingIn} onClick={() => void useMembership()}>Use membership</button></div>}{message && <p className="feedback" role="status">{message}</p>}<Link className="creator-link" to={`/creator/${currentPost.creator}`}>By {shorten(currentPost.creator)}</Link></article>;
}

function PostCard({ post }: { post: PostResponse }) { return <Link to={`/post/${post.id}`} className="post-card"><h2>{post.title}</h2><p>{post.caption}</p><span>{post.canView ? "View post" : <>Unlock for {formatKas(post.priceSompi)} KAS</>}</span></Link>; }
function Message({ title }: { title: string }) { return <section className="message"><h1>{title}</h1><Link className="secondary" to="/">Back home</Link></section>; }
function formatKas(sompi: string) { const padded = BigInt(sompi).toString().padStart(9, "0"); return `${padded.slice(0, -8)}.${padded.slice(-8)}`.replace(/\.?0+$/, ""); }
function shorten(address: string) { return `${address.slice(0, 16)}...${address.slice(-8)}`; }
