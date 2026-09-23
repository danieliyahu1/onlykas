import type { ReactNode } from "react";

type IconName = "check" | "edit" | "image-plus" | "search" | "trash" | "user";

const paths: Record<IconName, ReactNode> = {
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  edit: (
    <>
      <path d="M4 20h4L19.5 8.5l-4-4L4 16v4Z" />
      <path d="m14.5 6.5 4 4" />
    </>
  ),
  "image-plus": (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 16 4.5-4.5 4 4L17 11l3 3" />
      <path d="M9 9.5h.01" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M10 7V4h4v3" />
      <path d="M6.5 7 7.5 20h9L17.5 7" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" />
    </>
  ),
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className={`icon icon-${name}`} viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export function LockIcon({ open }: { open: boolean }) {
  return (
    <svg className="post-lock-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 11h14v9H5z" />
      {open ? (
        <path d="M8 11V7a4 4 0 0 1 7.7-1.5" />
      ) : (
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      )}
    </svg>
  );
}

export type MediaIconKind = "image" | "video" | "media";

const mediaPaths: Record<MediaIconKind, ReactNode> = {
  image: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4.5 16.5 4.5-4.5 3.5 3.5L16 12l3.5 3.5" />
      <path d="M9 9.5h.01" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m10.5 9.5 5 2.5-5 2.5v-5Z" fill="currentColor" stroke="none" />
    </>
  ),
  media: <rect x="3" y="5" width="18" height="14" rx="2" />,
};

export function MediaIcon({ kind }: { kind: MediaIconKind }) {
  return (
    <svg className="media-icon" viewBox="0 0 24 24" aria-hidden="true">
      {mediaPaths[kind]}
    </svg>
  );
}

export type VideoIconName =
  | "exit-fullscreen"
  | "fullscreen"
  | "mute"
  | "pause"
  | "play"
  | "unmute";

const videoPaths: Record<VideoIconName, ReactNode> = {
  "exit-fullscreen": (
    <path d="M9 3v6H3M15 3v6h6M21 15h-6v6M9 21v-6H3" />
  ),
  fullscreen: <path d="M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6" />,
  mute: <path d="M3 10v4h4l5 4V6l-5 4H3M16 9l5 6M21 9l-5 6" />,
  pause: <path d="M7 4v16M17 4v16" />,
  play: <path d="m8 5 11 7-11 7V5Z" fill="currentColor" stroke="none" />,
  unmute: <path d="M3 10v4h4l5 4V6l-5 4H3M16 9c2 2 2 4 0 6M19 6c4 4 4 8 0 12" />,
};

export function VideoIcon({ name }: { name: VideoIconName }) {
  return (
    <svg className="video-icon" viewBox="0 0 24 24" aria-hidden="true">
      {videoPaths[name]}
    </svg>
  );
}
