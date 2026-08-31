import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { CreatorResponse, PostResponse } from "@onlykas/shared";
import { api } from "./kasware.js";

export function CreatorPage() {
  const { address = "" } = useParams();
  const [creator, setCreator] = useState<CreatorResponse | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    void api<CreatorResponse>(`/api/creators/${encodeURIComponent(address)}`)
      .then(setCreator)
      .catch(() => setError(true));
  }, [address]);
  if (error) return <Message title="Creator not found." />;
  if (!creator) return <Message title="Opening profile..." />;
  return (
    <section className="profile">
      <p className="eyebrow">CREATOR</p>
      <h1>{creator.displayAddress}</h1>
      {creator.posts.length === 0 ? (
        <p>Nothing published yet.</p>
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

export function PostPage() {
  const { id = "" } = useParams();
  const [post, setPost] = useState<PostResponse | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    void api<PostResponse>(`/api/posts/${id}`)
      .then(setPost)
      .catch(() => setError(true));
  }, [id]);
  if (error) return <Message title="Post not found." />;
  if (!post) return <Message title="Opening post..." />;
  return (
    <article className="single-post">
      <p className="eyebrow">PRIVATE RELEASE</p>
      <h1>{post.title}</h1>
      <p className="description">{post.description}</p>
      <p className="price">
        {formatKas(post.priceSompi)} <small>KAS</small>
      </p>
      {post.canView ? (
        post.mediaType.startsWith("video/") ? (
          <video src={`/api/posts/${post.id}/media`} controls />
        ) : (
          <img src={`/api/posts/${post.id}/media`} alt={post.title} />
        )
      ) : (
        <button className="primary">
          Unlock for {formatKas(post.priceSompi)} KAS
        </button>
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
          {post.canView
            ? "View"
            : `Unlock for ${formatKas(post.priceSompi)} KAS`}
        </span>
      </div>
    </Link>
  );
}
function Message({ title }: { title: string }) {
  return (
    <section className="message">
      <p className="eyebrow">ONLYKAS</p>
      <h1>{title}</h1>
    </section>
  );
}
function formatKas(sompi: string) {
  const padded = BigInt(sompi).toString().padStart(9, "0");
  return `${padded.slice(0, -8)}.${padded.slice(-8)}`.replace(/\.?0+$/, "");
}
function shorten(address: string) {
  return `${address.slice(0, 16)}...${address.slice(-8)}`;
}
