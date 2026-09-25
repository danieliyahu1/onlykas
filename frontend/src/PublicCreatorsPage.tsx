import { useNavigate } from "react-router-dom";
import type { CreatorSearchResult } from "@kaskama/shared";
import { api, ApiError } from "./kasware.js";
import { Spinner } from "./Spinner.js";
import { useAsyncResource } from "./useAsyncResource.js";
import { creatorPath } from "./creator-url.js";

export function PublicCreatorsPage() {
  const navigate = useNavigate();
  const {
    data,
    loading,
    error: loadError,
  } = useAsyncResource(
    (signal) => api<CreatorSearchResult[]>("/api/creators/public", { signal }),
    [],
  );
  const creators = data ?? [];
  const error =
    loadError instanceof ApiError
      ? loadError.message
      : loadError
        ? "Creators could not be loaded."
        : null;

  return (
    <section className="find-page">
      <header>
        <h1>Creators.</h1>
      </header>
      {error && (
        <p className="feedback inline error" role="alert">
          {error}
        </p>
      )}
      {loading && (
        <p className="feedback inline">
          <Spinner /> Loading...
        </p>
      )}
      {!loading && !error && creators.length === 0 && (
        <p className="feedback inline">No creators yet.</p>
      )}
      <div className="creator-results">
        {creators.map((creator) => (
          <button
            className="creator-result"
            key={creator.address}
            onClick={() => navigate(creatorPath(creator.address))}
          >
            <strong>{creator.displayName ?? creator.displayAddress}</strong>
            {creator.displayName && <span>{creator.displayAddress}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
