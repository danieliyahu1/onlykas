import { Link } from "react-router-dom";
import { isVideoMedia, type MediaType } from "@onlykas/shared";
import { MediaIcon, type MediaIconKind } from "./Icons.js";

const LABELS: Record<MediaIconKind, string> = {
  image: "Image",
  video: "Video",
  media: "Media",
};

export function mediaIconKind(mediaType: MediaType): MediaIconKind {
  if (isVideoMedia(mediaType)) return "video";
  if (mediaType.startsWith("image/")) return "image";
  return "media";
}

export function MediaTypeBadge({
  mediaType,
  to,
}: {
  mediaType: MediaType;
  to?: string | undefined;
}) {
  const kind = mediaIconKind(mediaType);
  const icon = <MediaIcon kind={kind} />;
  const label = LABELS[kind];

  if (to) {
    return (
      <Link className="media-type-badge" to={to} aria-label={label}>
        {icon}
      </Link>
    );
  }

  return (
    <span className="media-type-badge" role="img" aria-label={label}>
      {icon}
    </span>
  );
}
