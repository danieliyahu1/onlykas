import { useEffect, useState } from "react";
import { isVideoMedia, type PostResponse } from "@kaskama/shared";
import { VideoPlayer } from "./VideoPlayer.js";

export function PostMedia({ post }: { post: PostResponse }) {
  const [mediaError, setMediaError] = useState(false);
  const isVideo = isVideoMedia(post.mediaType);
  const mediaLabel = post.caption || (isVideo ? "Video" : "Photo");
  const mediaUrl = `/api/posts/${encodeURIComponent(post.id)}/media`;

  useEffect(() => {
    setMediaError(false);
  }, [post.id]);

  if (mediaError) {
    return (
      <p className="feedback inline" role="alert">
        This media isn&apos;t available right now.
      </p>
    );
  }

  return isVideo ? (
    <VideoPlayer src={mediaUrl} label={mediaLabel} onError={() => setMediaError(true)} />
  ) : (
    <img
      className="post-media"
      src={mediaUrl}
      alt={mediaLabel}
      onError={() => setMediaError(true)}
    />
  );
}
