import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { mediaHintError, validatePost } from "@onlykas/shared";
import { COPY } from "./copy.js";
import { uploadMedia } from "./upload.js";
import { KaspaMark } from "./KaspaMark.js";
import { Icon } from "./Icons.js";
import { Toast, useToast } from "./Toast.js";

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
  const [detailsEdited, setDetailsEdited] = useState(false);
  const [form, setForm] = useState({
    caption: "Shared just for supporters.",
    priceKas: "1",
  });

  const { toast, showToast, dismissToast } = useToast();

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
      showToast(hint, "error");
      event.target.value = "";
      return;
    }
    dismissToast();
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
      showToast(caught instanceof Error ? caught.message : COPY.uploadFailed, "error");
      return null;
    } finally {
      setUploading(false);
    }
  }

  async function publishSelected(event: FormEvent) {
    event.preventDefault();
    if (!selectedFile || submitting) return;
    const errors = validatePost(form.caption, form.priceKas);
    if (errors.length) {
      showToast(errors.join(" "), "error");
      return;
    }
    setSubmitting(true);
    dismissToast();
    try {
      if (!address) {
        showToast("Sign in with Kasware to publish.");
        if (!(await signIn())) {
          dismissToast();
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
      ? "Publishing..."
      : "Publish";

  return (
    <>
      <section className="publish-card">
        <header className="publish-intro">
          <h1>Publish a post.</h1>
        </header>
        <form onSubmit={(event) => void publishSelected(event)}>
          <div className="publish-upload">
            <div className={selectedFile ? "media-stage has-media" : "media-stage"}>
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
                  title="Choose another"
                  onClick={chooseAnother}
                >
                  Replace <Icon name="image-plus" />
                </button>
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
                <span className="price-input">
                  <KaspaMark />
                  <span className="sr-only">KAS</span>
                  <input
                    inputMode="decimal"
                    value={form.priceKas}
                    onChange={(event) => {
                      setDetailsEdited(true);
                      setForm({ ...form, priceKas: event.target.value });
                    }}
                  />
                </span>
              </label>
              {detailsEdited && (
                <button
                  className="text-button restore-defaults"
                  type="button"
                  onClick={restoreDefaults}
                >
                  Reset
                </button>
              )}
            </div>

            {selectedFile && (
              <p className="permanence-note">
                You can&apos;t edit a post after publishing.
              </p>
            )}
            <button className="primary publish-action" disabled={!selectedFile || busy}>
              {selectedFile
                ? `${actionLabel} for ${form.priceKas || "0"} KAS`
                : actionLabel}
            </button>
          </div>
        </form>
      </section>
      <Toast toast={toast} />
    </>
  );
}
