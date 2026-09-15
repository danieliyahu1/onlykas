import { useCallback, useEffect, useRef, useState } from "react";

const TOAST_DURATION_MS = 5_000;

export type ToastTone = "error" | "info" | "success";
export type ToastMessage = {
  id: number;
  message: string;
  tone: ToastTone;
};

export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const nextId = useRef(0);

  const showToast = useCallback((message: string, tone: ToastTone = "info") => {
    setToast({ id: ++nextId.current, message, tone });
  }, []);

  const dismissToast = useCallback(() => {
    setToast(null);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(dismissToast, TOAST_DURATION_MS);
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismissToast();
    };
    window.addEventListener("keydown", dismissWithEscape);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", dismissWithEscape);
    };
  }, [dismissToast, toast?.id]);

  return { toast, showToast, dismissToast };
}

export function Toast({ toast }: { toast: ToastMessage | null }) {
  if (!toast) return null;
  const role = toast.tone === "error" ? "alert" : "status";
  return (
    <div className={`toast toast-${toast.tone}`} role={role} aria-atomic="true">
      {toast.message}
    </div>
  );
}
