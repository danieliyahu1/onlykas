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
