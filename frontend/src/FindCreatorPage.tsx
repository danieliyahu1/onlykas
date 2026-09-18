import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { isKaspaTestnetAddress, type CreatorSearchResult } from "@onlykas/shared";
import { api, ApiError } from "./kasware.js";
import { Spinner } from "./Spinner.js";
import { useAutoDismiss } from "./useAutoDismiss.js";

export function FindCreatorPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CreatorSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  useAutoDismiss(error, () => setError(null));

  useEffect(() => {
    const value = searchParams.get("q")?.trim() ?? "";
    setQuery(value);
    if (!value) return;
    if (isKaspaTestnetAddress(value)) {
      navigate(`/creator/${encodeURIComponent(value)}`, { replace: true });
      return;
    }
    if (value.startsWith("kaspatest:")) {
      setError("Enter the full address.");
      return;
    }
    setError(null);
    setResults([]);
    setSearched(false);
    setSearching(true);
    void api<CreatorSearchResult[]>(
      `/api/creators/search?q=${encodeURIComponent(value)}`,
    )
      .then((found) => {
        setResults(found);
        setSearched(true);
      })
      .catch((error: unknown) =>
        setError(
          error instanceof ApiError ? error.message : "Search failed. Try again.",
        ),
      )
      .finally(() => setSearching(false));
  }, [navigate, searchParams]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    if (!value) return;
    setSearchParams({ q: value });
  }

  return (
    <section className="find-page">
      <header>
        <h1>Find a creator.</h1>
      </header>
      <form onSubmit={search} noValidate>
        <label htmlFor="creator-query">
          Name or address
          <input
            id="creator-query"
            name="creator-query"
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setResults([]);
              setError(null);
              setSearched(false);
            }}
            placeholder="Name or Kaspa address"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {error && (
          <p className="feedback inline error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" type="submit" disabled={searching}>
          {searching && <Spinner />}
          {searching ? "Searching..." : "Search"}
        </button>
      </form>
      {searched && !searching && results.length === 0 && !error && (
        <p className="feedback">No creators found.</p>
      )}
      <div className="creator-results">
        {results.map((result) => (
          <button
            className="creator-result"
            key={result.address}
            onClick={() => navigate(`/creator/${encodeURIComponent(result.address)}`)}
          >
            <strong>{result.displayName ?? result.displayAddress}</strong>
            {result.displayName && <span>{result.displayAddress}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}
