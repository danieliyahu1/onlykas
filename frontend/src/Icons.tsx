type IconName =
  "arrow-left" | "arrow-right" | "check" | "search" | "user" | "x";

export function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, string> = {
    "arrow-left": "M19 12H5m7 7-7-7 7-7",
    "arrow-right": "M5 12h14m-7-7 7 7-7 7",
    check: "m5 12 4 4L19 6",
    search: "m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
    user: "M20 21a8 8 0 0 0-16 0m12-14a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
    x: "m6 6 12 12M18 6 6 18",
  };
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
