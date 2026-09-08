import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { PostResponse } from "@onlykas/shared";
import { api } from "./kasware.js";

export function WalletPostsPage({ address }: { address: string | null }) {
  const [posts, setPosts] = useState<PostResponse[] | null>(null);
  useEffect(() => { if (address) void api<{ posts: PostResponse[] }>("/api/wallet/posts").then(v => setPosts(v.posts)).catch(() => setPosts([])); }, [address]);
  if (!address) return <section className="message"><h1>Sign in to see your posts.</h1></section>;
  if (!posts) return <section className="message"><h1>Loading your posts...</h1></section>;
  return <section className="wallet-page"><p className="eyebrow">YOUR WALLET</p><h1>Your posts</h1>{posts.length ? <div className="post-grid">{posts.map(p => <article className="post-card" key={p.id}><Link to={`/post/${p.id}`}><h2>{p.title}</h2><p>{p.caption}</p></Link></article>)}</div> : <p>You have not published anything yet.</p>}</section>;
}
