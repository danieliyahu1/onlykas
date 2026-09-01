import { useEffect, useRef } from "react";

export function useAutoDismiss(
  message: string | null,
  clear: () => void,
  delay = 6_000,
) {
  const clearRef = useRef(clear);
  clearRef.current = clear;

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => clearRef.current(), delay);
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearRef.current();
    };
    window.addEventListener("keydown", dismiss);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", dismiss);
    };
  }, [delay, message]);
}
