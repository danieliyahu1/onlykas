import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  COPY,
  mediaHintError,
  validatePost,
} from "@onlykas/shared";
import { uploadMedia } from "./upload.js";
import { KaspaMark } from "./KaspaMark.js";
import { Icon } from "./Icons.js";
import { useAutoDismiss } from "./useAutoDismiss.js";

interface Props {
  address: string | null;
  signIn: () => Promise<string | null>;
  signingIn: boolean;
}

export function PublishPage({ address, signIn, signingIn }: Props) {
  const navigate = useNavigate();
  const mediaInput = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failure, setFailure] = useState<{
    code: string | null;
    message: string;
  } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [detailsEdited, setDetailsEdited] = useState(false);
  const [form, setForm] = useState({
    caption: "Shared just for supporters.",
    priceKas: "1",
  });

  useAutoDismiss(failure?.message ?? null, () => setFailure(null));

  const postTitle = selectedFile?.type.startsWith("video/")
    ? "Private video"
    : "Private photo";

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const hint = mediaHintError(file.type, file.size);
    if (hint) {
      setFailure({ code: null, message: hint });
      event.target.value = "";
      return;
    }
    setFailure(null);
    setStatus(null);
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  }

  function chooseAnother() {
    if (!mediaInput.current) return;
    mediaInput.current.value = "";
    mediaInput.current.click();
  }

  function restoreDefaults() {
    setForm({ caption: "Shared just for supporters.", priceKas: "1" });
    setDetailsEdited(false);
  }

  async function uploadFile(file: File): Promise<string | null> {
    setUploading(true);
    setProgress(0);
    try {
      const id = await uploadMedia(file, form.caption, form.priceKas, setProgress);
      return id;
    } catch (caught) {
      setFailure({
        code: null,
        message: caught instanceof Error ? caught.message : COPY.uploadFailed,
      });
      setStatus(null);
      return null;
    } finally {
      setUploading(false);
    }
  }

  async function publishSelected(event: FormEvent) {
    event.preventDefault();
    if (!selectedFile || submitting) return;
    const errors = validatePost(postTitle, form.caption, form.priceKas);
    if (errors.length) {
      setFailure({ code: null, message: errors.join(" ") });
      return;
    }
    setSubmitting(true);
    setFailure(null);
    try {
      if (!address) {
        setStatus("Sign in with Kasware to publish.");
        if (!(await signIn())) {
          setStatus(null);
          return;
        }
      }
      const id = await uploadFile(selectedFile);
      if (id) navigate(`/post/${id}`);
    } finally {
      setSubmitting(false);
    }
  }

  const busy = submitting || uploading || signingIn;
  const actionLabel = signingIn
    ? "Signing in..."
    : uploading
      ? `Uploading ${progress}%`
      : "Publish";

  return (
    <section className="publish-card">
      <header className="publish-intro">
        <h1>Share with your fans</h1>
      </header>
      <form onSubmit={(event) => void publishSelected(event)}>
        <div className="publish-upload">
          <div
            className={selectedFile ? "media-stage has-media" : "media-stage"}
          >
            <input
              ref={mediaInput}
              id="media"
              type="file"
              aria-label="Choose image or video"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
              onChange={selectFile}
              disabled={busy}
            />
            {selectedFile && previewUrl ? (
              selectedFile.type.startsWith("video/") ? (
                <video
                  src={previewUrl}
                  controls
                  aria-label="Selected video preview"
                />
              ) : (
                <img src={previewUrl} alt="Selected image preview" />
              )
            ) : (
              <label className="media-prompt" htmlFor="media">
                <strong>Add a photo or video</strong>
              </label>
            )}
            {uploading && (
              <progress value={progress} max="100">
                {progress}%
              </progress>
            )}
          </div>

          {selectedFile && !busy && (
            <div className="media-actions">
              <button
                className="change-media"
                type="button"
                aria-label="Change media"
                title="Choose another"
                onClick={chooseAnother}
              >
                Change media <Icon name="image-plus" />
              </button>
            </div>
          )}
          {!selectedFile && failure && (
            <div aria-live="polite" className="feedback inline error">
              {failure.message}
            </div>
          )}
        </div>

        <div className="publish-controls">
          <div className="publish-details">
            <label>
              Caption
              <textarea
                value={form.caption}
                maxLength={280}
                onChange={(event) => {
                  setDetailsEdited(true);
                  setForm({ ...form, caption: event.target.value });
                }}
              />
            </label>
            <label className="price-field">
              Price
              <span className="unit">
                <KaspaMark />
                <span className="sr-only">KAS</span>
              </span>
              <input
                inputMode="decimal"
                value={form.priceKas}
                onChange={(event) => {
                  setDetailsEdited(true);
                  setForm({ ...form, priceKas: event.target.value });
                }}
              />
            </label>
            {detailsEdited && (
              <button
                className="text-button restore-defaults"
                type="button"
                onClick={restoreDefaults}
              >
                Restore defaults
              </button>
            )}
          </div>

          {selectedFile && (
            <p className="permanence-note">
              Published posts cannot be changed.
            </p>
          )}
          <div
            aria-live="polite"
            className={
              failure || status ? "feedback inline error" : "feedback inline"
            }
          >
            {selectedFile ? failure?.message ?? status : status}
          </div>
          <button
            className="primary publish-action"
            disabled={!selectedFile || busy}
          >
            {selectedFile
              ? `${actionLabel} for ${form.priceKas || "0"} KAS`
              : actionLabel}
          </button>
        </div>
      </form>
    </section>
  );
}
