import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { mediaHintError, validatePost } from "@onlykas/shared";
import { COPY } from "./copy.js";
import { uploadMedia, type UploadResult } from "./upload.js";
import { Icon } from "./Icons.js";
import { Spinner } from "./Spinner.js";
import { errorText } from "./errors.js";
import { dismissToastIf, useToast } from "./Toast.js";
import type { WalletProps } from "./wallet.js";

const DEFAULT_CAPTION = "Shared just for supporters.";
const DEFAULT_PRICE_KAS = "1";

export function PublishPage({ address, signIn, signingIn }: WalletProps) {
  const navigate = useNavigate();
  const mediaInput = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [form, setForm] = useState({
    caption: DEFAULT_CAPTION,
    priceKas: DEFAULT_PRICE_KAS,
  });

  const { showToast, dismissToast } = useToast();

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

  async function uploadFile(file: File): Promise<UploadResult | null> {
    setUploading(true);
    setProgress(0);
    try {
      return await uploadMedia(file, form.caption, form.priceKas, setProgress);
    } catch (caught) {
      showToast(errorText(caught, COPY.uploadFailed), "error");
      return null;
    } finally {
      setUploading(false);
    }
  }

  async function ensureSignedIn(): Promise<boolean> {
    if (address) return true;
    const prompt = "Sign in with Kasware to publish.";
    showToast(prompt);
    const signedIn = await signIn();
    if (!signedIn) dismissToastIf(prompt);
    return Boolean(signedIn);
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
      if (!(await ensureSignedIn())) return;
      const result = await uploadFile(selectedFile);
      if (!result) return;
      navigate(`/post/${result.id}`, {
        state: result.duplicate ? { notice: COPY.mediaAlreadyPublished } : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  }

  const busy = submitting || uploading || signingIn;
  const actionLabel = publishActionLabel(signingIn, uploading);

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
                  className="secondary change-media"
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
                  onChange={(event) =>
                    setForm({ ...form, caption: event.target.value })
                  }
                />
              </label>
              <label className="price-field">
                Price
                <span className="price-input">
                  <input
                    inputMode="decimal"
                    value={form.priceKas}
                    onChange={(event) =>
                      setForm({ ...form, priceKas: event.target.value })
                    }
                  />
                  <span className="price-unit">KAS</span>
                </span>
              </label>
            </div>

            <p className="publish-free-note">Publishing is free.</p>
            <button className="primary publish-action" disabled={!selectedFile || busy}>
              {busy && <Spinner />}
              {actionLabel}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}

function publishActionLabel(signingIn: boolean, uploading: boolean): string {
  if (signingIn) return "Signing in...";
  if (uploading) return "Publishing...";
  return "Publish";
}
