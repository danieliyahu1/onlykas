type IconName =
  "arrow-right" | "check" | "image-plus" | "login" | "search" | "user";

const icons: Record<IconName, string> = {
  "arrow-right": "tcefkj4jmLp3",
  check: "VFaz7MkjAiu0",
  "image-plus": "368",
  login: "1CE0gYy8a1e6",
  search: "132",
  user: "kDoeg22e5jUY",
};

export function Icon({ name }: { name: IconName }) {
  return (
    <img
      className={`icon icon-${name}`}
      src={`https://img.icons8.com/?id=${icons[name]}&format=png&size=48`}
      alt=""
      aria-hidden="true"
    />
  );
}
