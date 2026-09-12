import { useRef, useState, type FormEvent } from "react";
import { COPY, FEEDBACK_MAX_MESSAGE } from "@onlykas/shared";
import { api, ApiError } from "./kasware.js";
import { logger } from "./logger.js";
import { useAutoDismiss } from "./useAutoDismiss.js";

export function FeedbackButton() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useAutoDismiss(toast, () => setToast(null), 2600);

  function open() {
    setNote(null);
    setSending(false);
    if (textRef.current) textRef.current.value = "";
    dialogRef.current?.showModal();
    textRef.current?.focus();
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = textRef.current?.value.trim() ?? "";
    if (!message) {
      setNote(COPY.feedbackRequired);
      return;
    }
    setSending(true);
    setNote(null);
    try {
      await api("/api/feedback", {
        method: "POST",
        body: JSON.stringify({ message }),
      });
      closeDialog();
      setToast(COPY.feedbackThanks);
    } catch (error) {
      setSending(false);
      logger.error("feedback_submit_failed", {
        code: error instanceof ApiError ? error.code : undefined,
        message: error instanceof Error ? error.message : undefined,
      });
      setNote(error instanceof Error ? error.message : COPY.feedbackFailed);
    }
  }

  return (
    <>
      <button
        type="button"
        className="feedback-button"
        onClick={open}
        aria-haspopup="dialog"
      >
        {COPY.feedbackButton}
      </button>
      <dialog
        ref={dialogRef}
        className="feedback-dialog"
        aria-labelledby="feedback-title"
      >
        <form
          className="feedback-form"
          onSubmit={(event) => void submit(event)}
          noValidate
        >
          <div className="feedback-head">
            <h2 id="feedback-title">{COPY.feedbackDialogTitle}</h2>
            <button
              type="button"
              className="feedback-close"
              aria-label="Close"
              onClick={closeDialog}
            >
              &times;
            </button>
          </div>
          <label className="feedback-label" htmlFor="feedback-text">
            {COPY.feedbackLabel}
          </label>
          <textarea
            id="feedback-text"
            ref={textRef}
            name="message"
            rows={5}
            maxLength={FEEDBACK_MAX_MESSAGE}
            placeholder={COPY.feedbackPlaceholder}
            aria-describedby="feedback-hint"
          />
          <p id="feedback-hint" className="feedback-hint">
            {COPY.feedbackHint}
          </p>
          {note && (
            <p className="feedback-note error" role="status">
              {note}
            </p>
          )}
          <div className="feedback-actions">
            <button type="submit" className="primary" disabled={sending}>
              {sending ? "Sending..." : COPY.feedbackSend}
            </button>
          </div>
        </form>
      </dialog>
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}