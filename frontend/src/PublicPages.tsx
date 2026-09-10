import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link, useParams } from "react-router-dom";
import type { CreatorResponse, PostResponse } from "@onlykas/shared";
import { api, signPreparedPayment, WalletError, ApiError } from "./kasware.js";
import { KaspaMark } from "./KaspaMark.js";

type WalletProps = { address: string | null; signIn: () => Promise<string | null>; signingIn: boolean };

export function CreatorPage({ address, signIn, signingIn }: WalletProps) {
  const { address: creatorAddress = "" } = useParams();
  const [creator, setCreator] = useState<CreatorResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [addressCopied, setAddressCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  async function loadCreator() {
    setLoading(true);
    setCreator(null);
    setLoadError(null);
    try {
      setCreator(await api<CreatorResponse>(`/api/creators/${encodeURIComponent(creatorAddress)}`));
    } catch (error) {
      setCreator(null);
      setLoadError(error instanceof ApiError ? error.message : null);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void loadCreator(); }, [creatorAddress]);
  if (loading) return <Message title="Loading creator..." />;
  if (!creator) return <Message title={loadError ?? "Creator unavailable."} />;
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
  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(currentCreator.address);
      setAddressCopied(true);
      window.setTimeout(() => setAddressCopied(false), 2_000);
    } catch {
      setMessage("Address could not be copied.");
    }
  }
  const showAccess = owner || currentCreator.membership.offered || currentCreator.membership.active;
  return <section className="profile"><div className="creator-identity"><h1 className={currentCreator.displayName ? undefined : "address-heading"}>{currentCreator.displayName ?? shorten(currentCreator.address)}</h1><button className="wallet-address" type="button" title={currentCreator.address} onClick={() => void copyAddress()}>{addressCopied ? "Copied" : shorten(currentCreator.address)}</button></div>{showAccess && <div className="access-strip"><div className="access-facts"><span>Every post</span><span>24 hours</span><span>1 KAS</span></div>{currentCreator.membership.active ? <span className="access-status">Subscribed</span> : owner && !currentCreator.membership.offered ? <button className="primary" disabled={busy || signingIn} onClick={() => void membershipAction()}>{busy ? "Opening..." : "Open access"}</button> : !owner && currentCreator.membership.offered ? <button className="primary" disabled={busy || signingIn} onClick={() => void membershipAction()}>{busy ? "Confirming..." : "Unlock all"}</button> : <span className="access-status">Access open</span>}{message && <p className="feedback inline" role="status">{message}</p>}</div>}<div className="post-grid">{currentCreator.posts.length ? currentCreator.posts.map((post) => <PostCard key={post.id} post={post} />) : <div className="empty-posts">{owner ? <><p>No posts yet.</p><Link className="secondary" to="/">Publish your first post</Link></> : <p>No posts yet.</p>}</div>}</div></section>;
}

export function PostPage({ address, signIn, signingIn }: WalletProps) {
  const { id = "" } = useParams();
  const [post, setPost] = useState<PostResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => { setPost(null); setMessage(null); setMediaError(false); setLoadError(null); void api<PostResponse>(`/api/posts/${encodeURIComponent(id)}`).then(setPost).catch((error: unknown) => { setLoadError(error instanceof ApiError ? error.message : null); setPost(null); }); }, [id]);
  if (!post) return <Message title={loadError ?? "Post unavailable."} />;
  const currentPost = post;
  async function unlock() {
    const buyer = address ?? (await signIn());
    if (!buyer) return;
    setBusy(true); setMessage(null);
    try {
      const prepared = await api<{ id: string; transaction: string }>(`/api/posts/${currentPost.id}/payments/prepare`, { method: "POST" });
      const signed = await signPreparedPayment(prepared.transaction);
      const result = await api<{ state: string; message?: string }>(`/api/payments/${prepared.id}/finalize`, { method: "POST", body: JSON.stringify({ signedTransaction: signed }) });
      if (result.state === "CONFIRMED") { setPost({ ...currentPost, canView: true }); setMessage(result.message ?? "Post unlocked."); return; }
      setMessage(result.message ?? "Payment is still confirming.");
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
  const mediaLabel = currentPost.mediaType.startsWith("video/") ? "Video" : "Photo";
  return <article className="single-post"><p className="caption">{currentPost.caption}</p>{currentPost.canView && !mediaError ? currentPost.mediaType.startsWith("video/") ? <VideoPlayer src={`/api/posts/${encodeURIComponent(currentPost.id)}/media`} label={currentPost.caption || mediaLabel} onError={() => setMediaError(true)} /> : <img className="post-media" src={`/api/posts/${encodeURIComponent(currentPost.id)}/media`} alt={currentPost.caption || mediaLabel} onError={() => setMediaError(true)} /> : mediaError ? <p className="feedback inline" role="alert">Media is temporarily unavailable.</p> : <div className="post-actions"><button className="primary" disabled={busy || signingIn} onClick={() => void unlock()}>{busy ? "Working..." : <>Unlock for {formatKas(currentPost.priceSompi)} <KaspaMark /></>}</button><button className="secondary" disabled={busy || signingIn} onClick={() => void useMembership()}>Use membership</button></div>}{message && <p className="feedback inline" role="status">{message}</p>}<Link className="creator-link" to={`/creator/${currentPost.creator}`}>By {shorten(currentPost.creator)}</Link></article>;
}

function PostCard({ post }: { post: PostResponse }) {
  const state = post.canView ? "Unlocked" : "Locked";
  return <Link to={`/post/${post.id}`} className="post-card"><span className={post.canView ? "post-lock unlocked" : "post-lock locked"}><LockIcon open={post.canView} /><span className="sr-only">{state}</span></span><div className="post-card-copy"><p>{post.caption}</p></div><span className="post-price">{formatKas(post.priceSompi)} KAS</span></Link>;
}

function LockIcon({ open }: { open: boolean }) {
  return <svg className="post-lock-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 11h14v9H5z" />{open ? <path d="M8 11V7a4 4 0 0 1 7.7-1.5" /> : <path d="M8 11V7a4 4 0 0 1 8 0v4" />}</svg>;
}

function VideoPlayer({ src, label, onError }: { src: string; label: string; onError: () => void }) {
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
  return <div className="video-player" tabIndex={0} role="group" aria-label={`${label} video`} onKeyDown={handleKeyDown}><video ref={video} src={src} playsInline preload="metadata" onClick={togglePlayback} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} onError={onError} />{!playing && <button className="video-play" type="button" aria-label="Play video" title="Play" onClick={togglePlayback}><VideoIcon name="play" /></button>}<div className="video-controls"><button type="button" onClick={togglePlayback} aria-label={playing ? "Pause video" : "Play video"} title={playing ? "Pause" : "Play"}><VideoIcon name={playing ? "pause" : "play"} /></button><input type="range" min="0" max={duration || 0} step="0.1" value={currentTime} aria-label="Video progress" onChange={(event) => seek(Number(event.target.value))} /><span className="video-time">{formatTime(currentTime)} / {formatTime(duration)}</span><button type="button" onClick={() => { if (video.current) video.current.muted = !video.current.muted; setMuted(!muted); }} aria-label={muted ? "Unmute video" : "Mute video"} title={muted ? "Unmute" : "Mute"}><VideoIcon name={muted ? "unmute" : "mute"} /></button><button type="button" onClick={() => void video.current?.requestFullscreen()} aria-label="Fullscreen video" title="Fullscreen"><VideoIcon name="fullscreen" /></button></div></div>;
}

function VideoIcon({ name }: { name: "fullscreen" | "mute" | "pause" | "play" | "unmute" }) {
  const paths = {
    fullscreen: <><path d="M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6" /></>,
    mute: <><path d="M3 10v4h4l5 4V6l-5 4H3M16 9l5 6M21 9l-5 6" /></>,
    pause: <><path d="M7 4v16M17 4v16" /></>,
    play: <path d="m8 5 11 7-11 7V5Z" fill="currentColor" stroke="none" />,
    unmute: <><path d="M3 10v4h4l5 4V6l-5 4H3M16 9c2 2 2 4 0 6M19 6c4 4 4 8 0 12" /></>,
  };
  return <svg className="video-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function Message({ title }: { title: string }) { return <section className="message"><h1>{title}</h1><Link className="secondary" to="/">Back home</Link></section>; }
function formatKas(sompi: string) { const padded = BigInt(sompi).toString().padStart(9, "0"); return `${padded.slice(0, -8)}.${padded.slice(-8)}`.replace(/\.?0+$/, ""); }
function formatTime(seconds: number) { if (!Number.isFinite(seconds)) return "0:00"; const minutes = Math.floor(seconds / 60); return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`; }
function shorten(address: string) { return `${address.slice(0, 16)}...${address.slice(-8)}`; }
