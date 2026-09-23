import { useState } from "react";

/**
 * A decorative, backend-blurred preview of locked media. It disappears rather
 * than showing a broken image when the preview cannot be produced yet, leaving
 * the surrounding locked placeholder in place.
 */
export function PreviewImage({
  src,
  className,
}: {
  src: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      className={className}
      src={src}
      alt=""
      aria-hidden="true"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
