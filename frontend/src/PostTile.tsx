import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PreviewImage } from "./PreviewImage.js";

export function PostTile({
  media,
  caption,
  date,
  action,
}: {
  media: ReactNode;
  caption: string;
  date?: string | undefined;
  action?: ReactNode;
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
  to,
  children,
}: {
  thumbnail?: string | undefined;
  to?: string | undefined;
  children?: ReactNode;
}) {
  const image = thumbnail ? (
    <PreviewImage className="post-tile-thumb" src={thumbnail} />
  ) : null;

  return (
    <div className="post-tile-media">
      {to ? (
        <Link className="post-tile-media-link" to={to} aria-label="Open post">
          {image}
        </Link>
      ) : (
        image
      )}
      {children}
    </div>
  );
}

export function PostTileAction({ children }: { children: ReactNode }) {
  return <div className="post-tile-action">{children}</div>;
}
