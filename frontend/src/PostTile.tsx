import type { ReactNode } from "react";
import { LockIcon, VideoIcon } from "./Icons.js";

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
}: {
  thumbnail?: string | undefined;
  overlay: PostTileOverlay;
}) {
  return (
    <div className="post-tile-media">
      {thumbnail ? (
        <img className="post-tile-thumb" src={thumbnail} alt="" loading="lazy" />
      ) : null}
      {overlay === "none" ? null : (
        <span className={`post-tile-overlay is-${overlay}`}>
          {overlay === "locked" ? <LockIcon open={false} /> : <VideoIcon name="play" />}
        </span>
      )}
    </div>
  );
}

export function PostTileAction({ children }: { children: ReactNode }) {
  return <div className="post-tile-action">{children}</div>;
}
