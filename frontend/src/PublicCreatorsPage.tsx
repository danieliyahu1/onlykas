import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CreatorSearchResult } from "@onlykas/shared";
import { api, ApiError } from "./kasware.js";
import { useAutoDismiss } from "./useAutoDismiss.js";

export function PublicCreatorsPage() {
  const navigate = useNavigate();
  const [creators, setCreators] = useState<CreatorSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useAutoDismiss(error, () => setError(null));

  useEffect(() => {
    void api<CreatorSearchResult[]>("/api/creators/public")
      .then(setCreators)
      .catch((reason: unknown) => {
        setError(reason instanceof ApiError ? reason.message : "Creators could not be loaded.");
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="find-page">
      <header>
        <p className="eyebrow">PUBLIC CREATORS</p>
        <h1>Meet the creators.</h1>
        <p className="find-intro">Wallets that chose to be visible on OnlyKas.</p>
      </header>
      {error && <p className="feedback error" role="alert">{error}</p>}
      {loading && <p className="feedback">Loading creators...</p>}
      {!loading && !error && creators.length === 0 && <p className="feedback">No public creators yet.</p>}
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
