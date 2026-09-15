import type { ReactNode } from "react";

type IconName = "check" | "image-plus" | "search" | "user";

const paths: Record<IconName, ReactNode> = {
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
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

export type VideoIconName = "fullscreen" | "mute" | "pause" | "play" | "unmute";

const videoPaths: Record<VideoIconName, ReactNode> = {
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
