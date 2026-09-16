import { useCallback, useEffect, useState } from "react";

export type ToastTone = "error" | "info" | "notice" | "success";
export type ToastMessage = {
  message: string;
  tone: ToastTone;
};

const CONFIRMATION_DWELL_MS = 5_000;
const EXPLANATION_DWELL_MS = 8_000;

const DWELL_MS: Record<ToastTone, number> = {
  error: EXPLANATION_DWELL_MS,
  info: CONFIRMATION_DWELL_MS,
  notice: EXPLANATION_DWELL_MS,
  success: CONFIRMATION_DWELL_MS,
};

export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const showToast = useCallback((message: string, tone: ToastTone = "info") => {
    setToast({ message, tone });
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  return { toast, showToast, dismissToast };
}

export function Toast({
  toast,
  onDismiss,
}: {
  toast: ToastMessage | null;
  onDismiss: () => void;
}) {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!toast || held) return;
    const timer = window.setTimeout(onDismiss, DWELL_MS[toast.tone]);
    return () => window.clearTimeout(timer);
  }, [held, onDismiss, toast]);

  useEffect(() => {
    if (!toast) return;
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", dismissOnEscape);
    return () => window.removeEventListener("keydown", dismissOnEscape);
  }, [onDismiss, toast]);

  if (!toast) return null;
  const role = toast.tone === "error" ? "alert" : "status";
  return (
    <div
      className={`toast toast-${toast.tone}`}
      role={role}
      aria-atomic="true"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <span className="toast-message">{toast.message}</span>
      <button
        className="toast-close"
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        &times;
      </button>
    </div>
  );
}
