import { useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  COPY,
  mediaHintError,
  validatePost,
  type UploadError,
} from "@onlykas/shared";
import { api } from "./kasware.js";
import { uploadMedia, waitForVerification } from "./upload.js";

interface Props {
  address: string | null;
  signIn: () => Promise<void>;
  signingIn: boolean;
}

const uploadMessages: Record<Exclude<UploadError, null>, string> = {
  UNSUPPORTED_MEDIA: COPY.unsupportedMedia,
  IMAGE_TOO_LARGE: COPY.imageTooLarge,
  VIDEO_TOO_LARGE: COPY.videoTooLarge,
  MALFORMED_MEDIA: COPY.malformedMedia,
  STORAGE_FAILURE: COPY.uploadFailed,
};

export function PublishPage({ address, signIn, signingIn }: Props) {
  const navigate = useNavigate();
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    priceKas: "",
  });

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      console.info("[OnlyKas upload] file picker closed without selection");
      return;
    }
    console.info("[OnlyKas upload] file selected", {
      name: file.name,
      type: file.type,
      size: file.size,
    });
    if (uploading) return;
    const hint = mediaHintError(file.type, file.size);
    if (hint) {
      console.warn("[OnlyKas upload] file rejected by client validation", {
        reason: hint,
      });
      setError(hint);
      event.target.value = "";
      return;
    }
    setError(null);
    setStatus(null);
    setUploading(true);
    setProgress(0);
    try {
      console.info("[OnlyKas upload] starting upload");
      const id = await uploadMedia(file, setProgress);
      console.info("[OnlyKas upload] upload completed", { uploadId: id });
      setStatus("Checking the complete file...");
      const verified = await waitForVerification(id);
      console.info("[OnlyKas upload] verification completed", {
        uploadId: id,
        state: verified.state,
        error: verified.error,
      });
      if (verified.state !== "VERIFIED")
        throw new Error(
          verified.error ? uploadMessages[verified.error] : COPY.uploadFailed,
        );
      setUploadId(id);
      setStatus("Media ready.");
    } catch (caught) {
      console.error("[OnlyKas upload] failed", caught);
      setError(caught instanceof Error ? caught.message : COPY.uploadFailed);
      setStatus(null);
    } finally {
      setUploading(false);
    }
  }

  function requestConfirmation(event: FormEvent) {
    event.preventDefault();
    const errors = validatePost(form.title, form.description, form.priceKas);
    if (!uploadId) errors.unshift("Choose and upload one file.");
    if (errors.length) {
      setError(errors.join(" "));
      return;
    }
    setError(null);
    setConfirming(true);
  }

  async function publish() {
    if (!uploadId || publishing) return;
    setPublishing(true);
    setStatus(COPY.publishing);
    setError(null);
    try {
      const post = await api<{ id: string }>("/api/posts", {
        method: "POST",
        body: JSON.stringify({ uploadId, ...form, permanenceConfirmed: true }),
      });
      setStatus(COPY.published);
      navigate(`/post/${post.id}`);
    } catch {
      setError(COPY.publishFailed);
      setStatus(null);
      setConfirming(false);
    } finally {
      setPublishing(false);
    }
  }

  if (!address)
    return (
      <section className="publish-card signed-out">
        <p className="eyebrow">CREATOR STUDIO</p>
        <h1>
          Make one thing
          <br />
          worth opening.
        </h1>
        <p>
          Publish private images and videos. Set the price. Share one clean
          link.
        </p>
        <button
          className="primary"
          disabled={signingIn}
          onClick={() => void signIn()}
        >
          {signingIn ? "Signing in..." : "Continue with Kasware"}
        </button>
      </section>
    );

  return (
    <section className="publish-card">
      <header>
        <p className="eyebrow">NEW RELEASE</p>
        <h1>
          Publish
          <br />
          something rare.
        </h1>
        <p className="wallet">Creating as {shorten(address)}</p>
      </header>
      <form onSubmit={requestConfirmation}>
        <div className="upload-well">
          <input
            id="media"
            type="file"
            aria-label="Choose image or video"
            accept="image/jpeg,image/png,image/webp,video/mp4,video/webm"
            onChange={(event) => void selectFile(event)}
            disabled={uploading || Boolean(uploadId)}
          />
          <label
            className="pick"
            htmlFor="media"
            onClick={() =>
              console.info("[OnlyKas upload] native file picker requested", {
                disabled: uploading || Boolean(uploadId),
              })
            }
          >
            <strong>
              {uploadId
                ? "Media secured"
                : uploading
                  ? `Uploading ${progress}%`
                  : "Choose image or video"}
            </strong>
            <span>
              JPEG, PNG, WebP up to 25 MB
              <br />
              MP4 or WebM up to 500 MB
            </span>
          </label>
          {uploading && (
            <progress value={progress} max="100" aria-label="Upload progress">
              {progress}%
            </progress>
          )}
        </div>
        <label>
          Title
          <input
            value={form.title}
            maxLength={80}
            onChange={(event) =>
              setForm({ ...form, title: event.target.value })
            }
            placeholder="Give it a name"
          />
        </label>
        <label>
          Description
          <textarea
            value={form.description}
            maxLength={280}
            onChange={(event) =>
              setForm({ ...form, description: event.target.value })
            }
            placeholder="Tell supporters what awaits"
          />
        </label>
        <label>
          Price <span className="unit">KAS</span>
          <input
            inputMode="decimal"
            value={form.priceKas}
            onChange={(event) =>
              setForm({ ...form, priceKas: event.target.value })
            }
            placeholder="0.00"
          />
        </label>
        <div
          aria-live="polite"
          className={error ? "feedback error" : "feedback"}
        >
          {error ?? status}
        </div>
        <button
          className="primary"
          disabled={!uploadId || uploading || publishing}
        >
          Review publication
        </button>
      </form>
      {confirming && (
        <div className="dialog-backdrop" role="presentation">
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <p className="eyebrow">LAST CHECK</p>
            <h2 id="confirm-title">No edits. No takebacks.</h2>
            <p>{COPY.permanence}</p>
            <div className="dialog-actions">
              <button
                className="primary"
                disabled={publishing}
                onClick={() => void publish()}
              >
                {publishing ? COPY.publishing : "Publish"}
              </button>
              <button
                className="secondary"
                disabled={publishing}
                onClick={() => {
                  setConfirming(false);
                  setStatus(COPY.publishingCancelled);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function shorten(address: string) {
  return `${address.slice(0, 16)}...${address.slice(-8)}`;
}
