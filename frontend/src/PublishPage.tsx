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
  type UploadError,
} from "@onlykas/shared";
import { api, ApiError } from "./kasware.js";
import { uploadMedia, waitForVerification } from "./upload.js";
import { KaspaMark } from "./KaspaMark.js";
import { Icon } from "./Icons.js";
import { useAutoDismiss } from "./useAutoDismiss.js";

interface Props {
  address: string | null;
  displayName: string | null;
  signIn: () => Promise<string | null>;
  signingIn: boolean;
}

const uploadMessages: Record<Exclude<UploadError, null>, string> = {
  UNSUPPORTED_MEDIA: COPY.unsupportedMedia,
  IMAGE_TOO_LARGE: COPY.imageTooLarge,
  VIDEO_TOO_LARGE: COPY.videoTooLarge,
  MALFORMED_MEDIA: COPY.malformedMedia,
  STORAGE_FAILURE: COPY.uploadFailed,
};

export function PublishPage({
  address,
  displayName,
  signIn,
  signingIn,
}: Props) {
  const navigate = useNavigate();
  const mediaInput = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failure, setFailure] = useState<{
    code: string | null;
    message: string;
  } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsEdited, setDetailsEdited] = useState(false);
  const [form, setForm] = useState({
    title: "Private photo",
    description: "Shared just for supporters.",
    priceKas: "1",
  });

  useAutoDismiss(failure?.message ?? null, () => setFailure(null));

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
    setUploadId(null);
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    if (!detailsEdited)
      setForm((current) => ({
        ...current,
        title: file.type.startsWith("video/")
          ? "Private video"
          : "Private photo",
      }));
  }

  function chooseAnother() {
    if (!mediaInput.current) return;
    mediaInput.current.value = "";
    mediaInput.current.click();
  }

  async function uploadFile(file: File): Promise<string | null> {
    setUploading(true);
    setProgress(0);
    try {
      const id = await uploadMedia(file, setProgress);
      setStatus("Preparing your post...");
      const verified = await waitForVerification(id);
      if (verified.state !== "VERIFIED")
        throw new Error(
          verified.error ? uploadMessages[verified.error] : COPY.uploadFailed,
        );
      setUploadId(id);
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

  async function publish(id: string) {
    setPublishing(true);
    setStatus(COPY.publishing);
    try {
      const post = await api<{ id: string }>("/api/posts", {
        method: "POST",
        body: JSON.stringify({
          uploadId: id,
          ...form,
          permanenceConfirmed: true,
        }),
      });
      navigate(`/post/${post.id}`);
    } catch (caught) {
      const apiFailure = caught instanceof ApiError ? caught : null;
      if (apiFailure?.code === "MEDIA_ALREADY_PUBLISHED") setUploadId(null);
      setFailure({
        code: apiFailure?.code ?? null,
        message: caught instanceof Error ? caught.message : COPY.publishFailed,
      });
      setStatus(null);
    } finally {
      setPublishing(false);
    }
  }

  async function publishSelected(event: FormEvent) {
    event.preventDefault();
    if (!selectedFile || submitting) return;
    const errors = validatePost(form.title, form.description, form.priceKas);
    if (errors.length) {
      setDetailsOpen(true);
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
      const id = uploadId ?? (await uploadFile(selectedFile));
      if (id) await publish(id);
    } finally {
      setSubmitting(false);
    }
  }

  const busy = submitting || uploading || publishing || signingIn;
  const actionLabel = signingIn
    ? "Signing in..."
    : uploading
      ? `Uploading ${progress}%`
      : publishing
        ? COPY.publishing
        : "Publish";

  return (
    <section className="publish-card">
      <header className="publish-intro">
        <p className="eyebrow">CREATE A POST</p>
        <h1>Share something special.</h1>
        <p className="publish-subtitle">
          {address
            ? displayName
              ? `Posting as ${displayName}`
              : "Ready when you are."
            : "Choose the moment. Sign in only when you publish."}
        </p>
      </header>
      <form onSubmit={(event) => void publishSelected(event)}>
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
              <span>It is the only thing you need.</span>
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
              aria-label={`Choose another ${selectedFile.type.startsWith("video/") ? "video" : "photo"}`}
              title="Choose another"
              onClick={chooseAnother}
            >
              <Icon name="image-plus" />
            </button>
          </div>
        )}

        {selectedFile && (
          <div className="publish-summary">
            <div>
              <strong>{form.title}</strong>
              <span>
                Supporters view for {form.priceKas || "0"} <KaspaMark />
                <span className="sr-only"> KAS</span>
              </span>
            </div>
            <button
              className="text-button"
              type="button"
              aria-expanded={detailsOpen}
              onClick={() => setDetailsOpen((open) => !open)}
            >
              {detailsOpen ? "Hide details" : "Edit details"}
            </button>
          </div>
        )}

        {selectedFile && detailsOpen && (
          <div className="optional-details">
            <label>
              Title
              <input
                value={form.title}
                maxLength={80}
                onChange={(event) => {
                  setDetailsEdited(true);
                  setForm({ ...form, title: event.target.value });
                }}
              />
            </label>
            <label>
              Note
              <textarea
                value={form.description}
                maxLength={280}
                onChange={(event) => {
                  setDetailsEdited(true);
                  setForm({ ...form, description: event.target.value });
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
          </div>
        )}

        <div
          aria-live="polite"
          className={failure ? "feedback error" : "feedback"}
        >
          {failure?.message ?? status}
        </div>
        <button
          className="primary publish-action"
          disabled={!selectedFile || busy}
        >
          {actionLabel} <Icon name="arrow-right" />
        </button>
        {selectedFile && (
          <p className="permanence-note">Published posts cannot be changed.</p>
        )}
      </form>
    </section>
  );
}
