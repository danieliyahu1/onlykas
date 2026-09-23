import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { LockIcon, VideoIcon } from "./Icons.js";
import { PreviewImage } from "./PreviewImage.js";

export type PostTileOverlay = "none" | "locked" | "video";

export function PostTile({
  media,
  caption,
  date,
  action,
}: {
  media: ReactNode;
  caption: string;
  date?: string | undefined;
  action: ReactNode;
}) {
  return (
    <article className="post-tile">
      {media}
      <div className="post-tile-copy">
        <p>{caption}</p>
        {date ? <span className="post-tile-date">{date}</span> : null}
      </div>
      {action}
    </article>
  );
}

export function PostTileMedia({
  thumbnail,
  overlay,
  to,
}: {
  thumbnail?: string | undefined;
  overlay: PostTileOverlay;
  to?: string | undefined;
}) {
  const content = (
    <>
      {thumbnail ? (
        <PreviewImage className="post-tile-thumb" src={thumbnail} />
      ) : null}
      {overlay === "none" ? null : (
        <span className={`post-tile-overlay is-${overlay}`}>
          {overlay === "locked" ? <LockIcon open={false} /> : <VideoIcon name="play" />}
        </span>
      )}
    </>
  );

  if (to) {
    return (
      <Link className="post-tile-media is-link" to={to} aria-label="Open post">
        {content}
      </Link>
    );
  }

  return <div className="post-tile-media">{content}</div>;
}

export function PostTileAction({ children }: { children: ReactNode }) {
  return <div className="post-tile-action">{children}</div>;
}
