import { useNavigate } from "react-router-dom";
import type { CreatorSearchResult } from "@onlykas/shared";
import { api, ApiError } from "./kasware.js";
import { useAsyncResource } from "./useAsyncResource.js";

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
        <p className="eyebrow">PUBLIC CREATORS</p>
        <h1>Meet the creators.</h1>
        <p className="find-intro">Wallets that chose to be visible on OnlyKas.</p>
      </header>
      {error && (
        <p className="feedback inline error" role="alert">
          {error}
        </p>
      )}
      {loading && <p className="feedback inline">Loading creators...</p>}
      {!loading && !error && creators.length === 0 && (
        <p className="feedback inline">No public creators yet.</p>
      )}
      <div className="creator-results">
        {creators.map((creator) => (
          <button
            className="creator-result"
            key={creator.address}
            onClick={() => navigate(`/creator/${encodeURIComponent(creator.address)}`)}
          >
            <strong>{creator.displayName ?? "Unnamed creator"}</strong>
            <span>{creator.displayAddress}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
